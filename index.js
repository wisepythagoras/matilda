const fs = require('fs');
const request = require('request');

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
 * Converts a longitude and zoom level into a number.
 * @param {number} lng The longitude.
 * @param {number} zoom The zoom level.
 * @returns {number}
 */
export const lngToTile = (lng, zoom) => {
    return (Math.floor((lng + 180) / 360 * Math.pow(2, zoom)));
};

/**
 * Converts a latitude and a zoom level into a number.
 * @param {number} lat The latitude.
 * @param {number} zoom The zoom level.
 * @returns {number}
 */
export const latToTile = (lat, zoom) => {
    const log = Math.log(
        Math.tan(lat * Math.PI / 180) + 1 /
        Math.cos(lat * Math.PI / 180)
    );

    return (Math.floor((1 - log / Math.PI) / 2 * Math.pow(2, zoom)));
};

/**
 * Get the X and Y tile ranges, given the bounding box and the zoom level.
 * @param {number[]} bbox 
 * @param {number} zoom The zoom level.
 * @returns {Bounds}
 */
export const bboxToBounds = (bbox, zoom) => {
    const bounds = {};

    bounds.north = latToTile(bbox[0], zoom);
    bounds.west = lngToTile(bbox[1], zoom);
    bounds.south = latToTile(bbox[2], zoom);
    bounds.east = lngToTile(bbox[3], zoom);

    return bounds;
};

/**
 * Gets a single tile.
 * @param {string} url The tile server url.
 * @param {string} output The output directory location.
 * @param {Coords} coords The coordinates.
 */
export const getTile = (url, output, coords) => {
    // Because the url will basically be a template with the {x}, {y} and {z} strings
    // in it, we replace those with the actual values.
    url = url.replace(/{x}/, coords.x);
    url = url.replace(/{y}/, coords.y);
    url = url.replace(/{z}/, coords.z);
};

/**
 * Scrape all of the tiles.
 * @param {Options} options The input options.
 * @param {Function} callback The callback function.
 */
export const getTiles = (options, callback) => {
    let tileCount = 0;

    // This will hold all of the coordinate information.
    /** @type {Coords} */
    const coords = {
        z: options.zoom.min,
    };

    // Get the bounds.
    const bounds = bboxToBounds(options.bbox, coords.z);

    // Fill out the rest of the coordinates.
    coords.x = bounds.east;
    coords.y = bounds.south;
};
