var Deferred = require('../../../node_modules/sails/node_modules/waterline/lib/waterline/query/deferred');
var hook = require('../../../node_modules/sails-generate-role/lib/hookLogic');

module.exports = function (sails) {
    return {
        configure: function () {
            sails.config.paths.roles = sails.config.appPath + '/api/roles';
        },
        initialize: function (next) {
            //After user config is loaded, do our processing (before policies are applied to routes)
            sails.after('hook:userconfig:loaded', function () {

                hook.loadRoles();
                hook.patchDeferred(Deferred);
                
            });

            sails.after('hook:orm:loaded', function () {

            });

            next();
        }
    };
};