module.exports = {
  // The default-off Android foreground trial plugin owns manual host wiring.
  dependency: { platforms: { ios: { podspecPath: __dirname + '/Phone11Siprix.podspec' }, android: null } },
};
