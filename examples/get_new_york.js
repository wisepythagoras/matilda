const matilda = require('../index');

const options = {
    url : 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    output: 'tiles',
    // [south, west, north, east]
    bbox: [40.699251, -74.025793, 40.742120, -73.968458],
    zoom : {
        max : 15,
        min : 14,
    },
    verbose: true,
};

// Get the tiles.
matilda.getTiles(options, err => {
    console.log(err);
    process.exit(1);
});
