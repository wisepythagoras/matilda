const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

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
 *     verbose: boolean,
 * }} Options
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
 * @param {Function} callback The callback function.
 * @param {boolean} verbose Self explanatory.
 */
const getTile = (templateUrl, output, coords, callback, verbose = false) => {
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
    const image = `${path}/${coords.y}.png`;

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
        responseType: 'stream'
    })
    .then(res => {
        res.data.pipe(fs.createWriteStream(image));
    })
    .finally(() => callback());
};

/**
 * Scrape all of the tiles.
 * @param {Options} options The input options.
 * @param {Function} callback The callback function.
 */
const getTiles = (options, callback) => {
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

    // Check if the output directory exists. If it doesn't, create it.
    if (!createDir(options.output)) {
        return callback(pathError(options.output));
    }

    if (!!options.verbose) {
        console.log(`Server: ${options.url}`);
    }

    /**
     * The callback for the tile getter.
     * @param {Error} err An error.
     */
    const tileGetCallback = err => {
        if (err) {
            return callback(err);
        }

        count++;

        // Increment the Y coords.
        coords.y++;

        // We scan from north to south. Every time we finish with a row, we move to
        // the next row (or Y line).
        if (coords.y <= bounds.south) {
            getTile(options.url, options.output, coords, tileGetCallback, options.verbose);
            return;
        }

        // Increment the X coords.
        coords.x++;

        // Reset the Y coords.
        coords.y = bounds.north;

        // Move to the next column and as long as it's within the selected bounds, we
        // get that tile.
        if (coords.x <= bounds.east) {
            getTile(options.url, options.output, coords, tileGetCallback, options.verbose);
            return;
        }

        // Increment the zoom level and recalculate the bounds.
        bounds = bboxToBounds(options.bbox, ++coords.z);

        // Set the coords again.
        coords.x = bounds.west;
        coords.y = bounds.north;

        // Move one level down. Which means that we zoom in and then download all the
        // tiles in there.
        if (coords.z <= options.zoom.max) {
            return getTile(options.url, options.output, coords, tileGetCallback, options.verbose);
        }

        if (!!options.verbose) {
            console.log(`Downloaded ${count} tiles.`);
        }
    };

    // Start fetching the tiles.
    getTile(options.url, options.output, coords, tileGetCallback, options.verbose);
};

module.exports.lngToTile = lngToTile;
module.exports.latToTile = latToTile;
module.exports.bboxToBounds = bboxToBounds;
module.exports.getTiles = getTiles;
