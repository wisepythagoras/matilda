const fs = require('fs');
const cluster = require("cluster");
const numCPUs = require("os").cpus().length || 1;
const crypto = require('crypto');
const axios = require('axios');

// Define the valid tile image formats.
const VALID_FORMATS = ['png', 'jpg', 'jpeg'];

/**
 * The object that defines the coordinates. It contains a zoom an x and a y.
 * @typedef {{
 *     z: number,
 *     x: number,
 *     y: number,
 * }} Coords
 */

/**
 * This structure represents a bounding box into a descriptive object.
 * @typedef {{
 *     north: number,
 *     west: number,
 *     south: number,
 *     east: number,
 * }} Bounds
 */

/**
 * The options type.
 * @typedef {{
 *     url: string,
 *     bbox: number[],
 *     output: string,
 *     zoom: {
 *         min: number,
 *         max: number,
 *     },
 *     referrer: string,
 *     verbose: boolean,
 *     format: 'png'|'jpeg'|'jpeg',
 * }} Options
 */

/**
 * The job type.
 * @typedef {{
 *     url: string,
 *     output: string,
 *     verbose: boolean,
 *     coords: Coords,
 *     format: 'png'|'jpeg'|'jpeg',
 *     worker: number,
 * }} Job
 */

/**
 * Get the SHA1 hash of a string.
 * @param {string} str The string to hash.
 * @returns {string} The hex hash.
 */
const getSHA1 = str => {
    const shasum = crypto.createHash('sha1');
    shasum.update(str);
    return shasum.digest('hex');
}

/**
 * Convert a template URL to an actual working URL.
 * @param {string} url The tile server url.
 * @param {Coords} coords The coordinates.
 * @returns {string} The modified URL.
 */
const templateToUrl = (url, coords) => {
    // Because the url will basically be a template with the {x}, {y} and {z} strings
    // in it, we replace those with the actual values.
    url = url.replace(/{x}/, coords.x);
    url = url.replace(/{y}/, coords.y);
    url = url.replace(/{z}/, coords.z);

    return url;
};

/**
 * Create a directory.
 * @param {string} path The path of the directory.
 * @returns {boolean}
 */
const createDir = path => {
    // Create the directory, only if it doesn't already exist.
    if (!fs.existsSync(path)) {
        try {
            fs.mkdirSync(path);
        } catch (e) {
            if (e.code !== 'EEXIST') {
                return false;
            }
        }
    }

    return true;
};

/**
 * Return a generic path error.
 * @param {string} path The path of the directory.
 * @returns {Error}
 */
const pathError = path => new Error(`Failed to create "${path}"`);

/**
 * Converts a longitude and zoom level into a number.
 * @param {number} lng The longitude.
 * @param {number} zoom The zoom level.
 * @returns {number}
 */
const lngToTile = (lng, zoom) => {
    return (Math.floor((lng + 180) / 360 * Math.pow(2, zoom)));
};

/**
 * Converts a latitude and a zoom level into a number.
 * @param {number} lat The latitude.
 * @param {number} zoom The zoom level.
 * @returns {number}
 */
const latToTile = (lat, zoom) => {
    const log = Math.log(
        Math.tan(lat * Math.PI / 180) + 1 /
        Math.cos(lat * Math.PI / 180)
    );

    return (Math.floor((1 - log / Math.PI) / 2 * Math.pow(2, zoom)));
};

/**
 * Get the X and Y tile ranges, given the bounding box and the zoom level.
 * @param {number[]} bbox The bounding box.
 * @param {number} zoom The zoom level.
 * @returns {Bounds}
 */
const bboxToBounds = (bbox, zoom) => {
    const bounds = {};

    bounds.south = latToTile(bbox[0], zoom);
    bounds.west = lngToTile(bbox[1], zoom);
    bounds.north = latToTile(bbox[2], zoom);
    bounds.east = lngToTile(bbox[3], zoom);

    return bounds;
};

/**
 * Gets a single tile.
 * @param {string} templateUrl The tile server url.
 * @param {string} output The output directory location.
 * @param {Coords} coords The coordinates.
 * @param {string} referrer The referrer, if there is one.
 * @param {Function} callback The callback function.
 * @param {boolean} verbose Self explanatory.
 * @param {'png'|'jpeg'|'jpeg'} format The format of the image.
 */
const getTile = (
    templateUrl,
    output,
    coords,
    referrer,
    callback,
    verbose = false,
    format = 'png'
) => {
    // Create the damn URL.
    const url = templateToUrl(templateUrl, coords);

    // Create the path.
    let path = `${output}/${coords.z}`;

    // Create the Z path.
    if (!createDir(path)) {
        return callback(pathError(path));
    }

    // Add the X folder to the path.
    path = `${path}/${coords.x}`;

    // Create the X path.
    if (!createDir(path)) {
        return callback(pathError(path));
    }

    // Compose the path of the image.
    const image = `${path}/${coords.y}.${format}`;

    // Check for the image, and if it doesn't exist, create it.
    if (fs.existsSync(image)) {
        if (verbose) {
            console.log(` HAS: ${url}`);
        }

        return callback(null);
    }

    if (verbose) {
        console.log(` GET: ${url}`);
    }

    // Fetch the image.
    axios({
        method: 'get',
        url,
        responseType: 'stream',
        headers: {
            'Referer': referrer,
        },
    })
    .then(res => {
        res.data.pipe(fs.createWriteStream(image));
    })
    .finally(() => callback());

    // Return the url.
    return url;
};

/**
 * Scrape all of the tiles.
 * @param {Options} options The input options.
 * @param {Function} callback The callback function.
 */
const getTiles = (options, callback) => {
    // This will give us some cool metrics at the end.
    const hrstart = process.hrtime();

    let count = 0;

    // This will hold all of the coordinate information.
    /** @type {Coords} */
    const coords = {
        z: options.zoom.min,
    };

    // Get the bounds.
    let bounds = bboxToBounds(options.bbox, coords.z);

    // Fill out the rest of the coordinates.
    coords.x = bounds.west;
    coords.y = bounds.north;

    // The format of the output tiles.
    const format = !!~VALID_FORMATS.indexOf(options.format) ?
        options.format : 'png';

    /**
     * Gets the next job.
     * @returns {Job}
     */
    const getNextJob = () => {
        if (coords.z > options.zoom.max)  {
            return;
        }

        // Increment the count.
        count++;

        // Increment the Y coords.
        coords.y++;

        // We scan from north to south. Every time we finish with a row, we move to
        // the next row (or Y line).
        if (coords.y <= bounds.south) {
            return {
                url: options.url,
                output: options.output,
                verbose: options.verbose,
                referrer: !!options.referrer ? options.referrer : null,
                coords,
                format,
            };
        }

        // Increment the X coords.
        coords.x++;

        // Reset the Y coords.
        coords.y = bounds.north;

        // Move to the next column and as long as it's within the selected bounds, we
        // get that tile.
        if (coords.x <= bounds.east) {
            return {
                url: options.url,
                output: options.output,
                verbose: options.verbose,
                referrer: !!options.referrer ? options.referrer : null,
                coords,
                format,
            };
        }

        // Increment the zoom level and recalculate the bounds.
        bounds = bboxToBounds(options.bbox, ++coords.z);

        // Set the coords again.
        coords.x = bounds.west;
        coords.y = bounds.north;

        // Move one level down. Which means that we zoom in and then download all the
        // tiles in there.
        if (coords.z <= options.zoom.max) {
            return {
                url: options.url,
                output: options.output,
                verbose: options.verbose,
                referrer: !!options.referrer ? options.referrer : null,
                coords,
                format,
            };
        }
    };

    // Check if the output directory exists. If it doesn't, create it.
    if (!createDir(options.output)) {
        return callback(pathError(options.output));
    }

    if (cluster.isMaster) {
        let stopped = 0;

        /**
         * Stop all child processes.
         */
        const stopChildProcesses = () => {
            stopped++;

            if (stopped < numCPUs) {
                return;
            }

            // Terminate all child processes.
            for (const id in cluster.workers) {
                cluster.workers[id].kill();
            }

            if (!!options.verbose) {
                console.log(`Downloaded ${count} tiles.`);
            }

            callback();
        };

        // Create a few processes so that we can start downloading our tiles in
        // parallel.
        for (let i = 0; i < numCPUs; i++) {
            cluster.fork();
        }

        for (const id in cluster.workers) {
            let worker = cluster.workers[id];

            // Listen for messages.
            (worker => {
                worker.on('message', msg => {
                    if (!!msg.success) {
                        console.log(' ', msg.err);
                    }

                    // Get the next job.
                    const nextJob = getNextJob();

                    if (nextJob) {
                        // If there was a next job, then send it to the next job.
                        return worker.send(nextJob);
                    }

                    // We're at the end and we need to stop all processes.
                    stopChildProcesses();
                });
            })(worker);

            // Send the new worker a job.
            cluster.workers[id].send({
                url: options.url,
                output: options.output,
                verbose: options.verbose,
                referrer: !!options.referrer ? options.referrer : null,
                coords,
                format,
                worker: id,
            });
        }

        cluster.on("exit", (worker, code, signal) => {
            // Show some message about the workers?
        });
    } else {
        // Handle any incoming messages to the child process.
        process.on('message', msg => {
            /**
             * Define the callback.
             * @param {any} err If there was any error.
             */
            const callback = err => {
                // Compose the message.
                const message = {
                    url: msg.url,
                    success: !!err,
                    err,
                };

                // Send the message back.
                process.send(message);
            };

            // Get the tile.
            getTile(
                msg.url,
                msg.output,
                msg.coords,
                msg.referrer,
                callback,
                msg.coords,
                msg.format
            );
        });
    }
};

module.exports.lngToTile = lngToTile;
module.exports.latToTile = latToTile;
module.exports.bboxToBounds = bboxToBounds;
module.exports.getTiles = getTiles;
