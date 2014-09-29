var buildDictionary = require('../../../node_modules/sails/node_modules/sails-build-dictionary');
var Deferred = require('../../../node_modules/sails/node_modules/waterline/lib/waterline/query/deferred');

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
                }, function (err, roles) {

                    sails.roles = roles;
                });
            });

            //Inject methods into the default model configuration, so that
            // all models will receive this method
            sails.after('hook:userconfig:loaded', function () {
                //monkey patching the deferred is probably not a good idea.. 
                //but as harmony proxies are not here yet.. well..
                Deferred.prototype.execWithRoleFilter = function (request, cb) {
                    //Do stuff first and modify select etc
                    var model = this._context.__proto__.identity;

                    //Wrap logic from index.js
                    if (sails.config.roles.models[model]) {
                        if (request.roles) {

                            //... deep down

                            if (this._values) {
                                //Probably an create or update, find stuff accordingly

                            }
                            else {
                                //Only adjust where clause..
                            }

                            this.exec(cb);
                        }
                    }

                };
            });

            sails.after('hook:orm:loaded', function () {
                console.log("orm loaded");
            });

            next();
        }
    };
};