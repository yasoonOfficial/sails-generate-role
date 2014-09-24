var buildDictionary = require('../../../node_modules/sails/node_modules/sails-build-dictionary');

module.exports = function (sails) {
  return {
    configure: function () {
      sails.config.paths.roles = sails.config.appPath + '/api/roles';
    },
    initialize: function (next) {
      sails.after('hook:blueprints:loaded', function () {
		
		// Load app controllers
		buildDictionary.optional({
			dirname: sails.config.paths.roles,
			filter: /(.+)Role\.(js|coffee|litcoffee)$/,
			flattenDirectories: true,
			keepDirectoryPath: true,
			replaceExpr: /Role/
			}, function(err, roles) {
			
			sails.roles = roles;
		});	
      });
	  
	  next();
    }
  };
};
