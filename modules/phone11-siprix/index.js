'use strict';

const { NativeModules } = require('react-native');

// No JS credential storage, implicit initialization, or alternate SIP engine.
module.exports = NativeModules.Phone11Siprix;
