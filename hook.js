var buildDictionary = require('../../../node_modules/sails/node_modules/sails-build-dictionary');
var Deferred = require('../../../node_modules/sails/node_modules/waterline/lib/waterline/query/deferred');
var _ = require('../../../node_modules/sails/node_modules/lodash/lodash');

module.exports = function (sails) {
    return {
        configure: function () {
            sails.config.paths.roles = sails.config.appPath + '/api/roles';
        },
        initialize: function (next) {
            //After user config is loaded, do our processing (before policies are applied to routes)
            sails.after('hook:userconfig:loaded', function () {

                // Load roles
                buildDictionary.optional({
                    dirname: sails.config.paths.roles,
                    filter: /(.+)Role\.(js|coffee|litcoffee)$/,
                    flattenDirectories: true,
                    keepDirectoryPath: true,
                    replaceExpr: /Role/
                }, function (err, roles) {
                    //Process the roles:
                    // 1. Mix in stuff from policy.js (model restrictions)
                    // => Loop over policy keys & check for models
                    _.forEach(sails.config.policies, function (value, key) {
                        var modelKey = key.toLower();
                        if (_.has(sails.models, modelKey) && _.isObject(sails.models[modelKey])) {
                            //loop over roles and collect infos
                            _.forEach(sails.models[modelKey], function (roleAttributes, roleKey) {
                                var normalizedRoleKey = roleKey.toLower();

                                //Dumb merging algorithm, does not care about clashes currently.. Could be a todo in the future
                                if (roles[normalizedRoleKey]) {
                                    roles[normalizedRoleKey].models = roleAttributes[normalizedRoleKey].models || {};
                                    roles[normalizedRoleKey].models[modelKey] = roles[normalizedRoleKey].models[modelKey] || {};
                                    _.merge(roles[normalizedRoleKey].models[modelKey], sails.models[modelKey][roleKey]);
                                }
                                else {
                                    //Error, role not found
                                    throw new ('Role ' + roleKey + ', provided in policies.js does not exist!');
                                }
                            });

                            //Delete "fake" object from policies (should not matter as would be overwritten by any controller but well)
                            delete sails.config.policies[key];
                        }
                    });

                    // 2. Mix controller policies from role to sails.policies
                    // => In this case, do not overwrite but OR new policies to the existing ones
                    _.forEach(roles, function (role, roleKey) {
                        if (role.controllers) {
                            _.forEach(role.controllers, function (controller, controllerKey) {
                                //If this controller is has no policy yet, just copy it
                                var controllerConfig = sails.config.policies[controllerKey];
                                if (!controllerConfig) {
                                    sails.config.policies[controllerKey] = controllerConfig = controller;
                                }
                                //Otherwise, action base processing
                                else {
                                    _.forEach(controller, function (action, actionKey) {
                                        //If action has no policy yet, just copy
                                        if (!controllerConfig[actionKey]) {
                                            controllerConfig[actionKey] = action;
                                        }
                                        //Otherwise, add policies
                                        else {
                                            //When it's no array already, make it an array
                                            var roleActions = (_.isArray(action)) ? action : [action];
                                            
                                            if (!_.isArray(controllerConfig[actionKey]))
                                                controllerConfig[actionKey] = [controllerConfig[actionKey]];

                                            //Join policies
                                            controllerConfig[actionKey] = _.union(controllerConfig[actionKey], roleActions);
                                        }
                                    });
                                }
                            });
                        }
                    });

                    // 3. Store model based access in sails.config.roles.models
                    // => Loop over all roles & restructure based on model
                    var modelBased = {};
                    _.forEach(roles, function (role, roleKey) {
                        if (role.models) {
                            _.forEach(role.models, function (modelRestriction, modelKey) {
                                modelBased[modelKey] = modelBased[modelKey] || {};
                                modelBased[modelKey][roleKey] = role;
                            });
                        }
                    });

                    sails.config.roles.models = modelBased;

                    // 4. Store role based access in sails.roles
                    sails.roles = roles;
                });

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