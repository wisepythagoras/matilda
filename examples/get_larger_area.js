const matilda = require('../index');

const options = {
    url : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    output: 'sat-tiles',
    // [south, west, north, east]
    bbox: [40.551374, -74.652100, 42.138968, -73.037109],
    zoom : {
        max : 17,
        min : 14,
    },
    verbose: true,
    format: 'jpg',
};

// Get the tiles.
matilda.getTiles(options, err => {
    console.log(err);
    process.exit(1);
});
