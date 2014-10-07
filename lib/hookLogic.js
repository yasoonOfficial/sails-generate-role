var buildDictionary = require('sails-build-dictionary');
var _ = require('lodash');
var core = require('./functions');

var logicFunctions = {

    loadRoles: function (roleCtx) {
        //Load roles & build dictionary
        buildDictionary.optional({
            dirname: sails.config.paths.roles,
            filter: /(.+)Role\.(js|coffee|litcoffee)$/,
            flattenDirectories: true,
            keepDirectoryPath: true,
            replaceExpr: /Role/
        }, function (err, roles) {
            logicFunctions.attachRoles(roles, roleCtx);
        });
    },

    attachRoles: function attachRoles(roles, roleCtx) {

        //Precheck context
        if (!roleCtx.resolveRoles || typeof (roleCtx.resolveRoles) !== 'function')
            throw 'RoleContext does not implement "resolveRoles" method!';
        
        //Process the roles:
        // 1. Mix in stuff from policy.js (model restrictions)
        // => Loop over policy keys & check for models
        _.forEach(sails.config.policies, function (value, key) {
            var modelKey = key.toLowerCase();
            if (_.has(sails.models, modelKey) && _.isObject(sails.models[modelKey])) {
                //loop over roles and collect infos
                _.forEach(sails.config.policies[key], function (roleAttributes, roleKey) {
                    var normalizedRoleKey = roleKey.toLowerCase();

                    //Dumb merging algorithm, does not care about clashes currently.. Could be a todo in the future
                    if (roles[normalizedRoleKey]) {
                        //If models restrictions are present on role level, transform to unified name (lowercase)
                        if (roles[normalizedRoleKey].models) {
                            roles[normalizedRoleKey].models = _.transform(roles[normalizedRoleKey].models, function (result, value, key) {
                                result[key.toLowerCase()] = value;
                            });
                        }
                        else {
                            roles[normalizedRoleKey].models = {};
                        }

                        //Merge all other restrictions from policies
                        roles[normalizedRoleKey].models[modelKey] = roles[normalizedRoleKey].models[modelKey] || {};
                        _.merge(roles[normalizedRoleKey].models[modelKey], roleAttributes);
                    }
                    else {
                        //Error, role not found
                        throw 'Role ' + roleKey + ', provided in policies.js does not exist!';
                    }
                });

                //Delete "fake" object from policies (should not matter as would be overwritten by any controller but well)
                delete sails.config.policies[key];
            }
        });

        // 2. Mix controller policies & new model policies from role to sails.policies
        // => In this case, do not overwrite but OR new policies to the existing ones
        // First: collect roles per controller action (or controller)
        var controllerRoles = {};

        _.forEach(roles, function (role, roleKey) {
            if (role.controllers) {
                _.forEach(role.controllers, function (controller, controllerKey) {
                    if (!controllerRoles[controllerKey]) {
                        controllerRoles[controllerKey] = {};
                        controllerPolicies[controllerKey] = {};
                    }

                    _.forEach(controller, function (action, actionKey) {
                        if (!controllerRoles[controllerKey][actionKey])
                            controllerRoles[controllerKey][actionKey] = [];

                        //If it's a bool value (and true) add current role to role list for this action
                        if (_.isBoolean(action) && action) {
                            controllerRoles[controllerKey][actionKey] = _.union(controllerRoles[controllerKey][actionKey], [roleKey]);
                        }
                        else {
                            //Currently not supported
                            throw 'Not supported controller action value: ' + action + ' @Role ' + roleKey + ' -> ' + controllerKey + ' -> ' + actionKey;
                        }
                    });
                });
            }
        });

        var addedModels = [];
        _.forEach(roles, function (role, roleKey) {

            if (role.controllers) {
                _.forEach(role.controllers, function (controller, controllerKey) {
                    //If this controller is has no policy yet, just copy it
                    var controllerConfig = sails.config.policies[controllerKey];
                    
                    if (!controllerConfig)
                        sails.config.policies[controllerKey] = controllerConfig = {};

                    _.forEach(controller, function (action, actionKey) {
                        //If action has no policy yet, just stuff in
                        if (!controllerConfig[actionKey]) {
                            controllerConfig[actionKey] = [core.getControllerPolicyHandler(controllerRoles[controllerKey][actionKey])];
                        }
                        //Otherwise, add policies
                        else {
                            var rolePolicies = [core.getControllerPolicyHandler(controllerRoles[controllerKey][actionKey])];

                            if (!_.isArray(controllerConfig[actionKey]))
                                controllerConfig[actionKey] = [controllerConfig[actionKey]];

                            //Join policies
                            controllerConfig[actionKey] = _.union(controllerConfig[actionKey], rolePolicies);
                        }
                    });
                });
            }

            if (role.models) {
                _.forEach(role.models, function (model, modelKey) {
                    //Check if policies for current model were already registered
                    if (!_.contains(addedModels, modelKey) && sails.controllers[modelKey]) {
                        addedModels.push(modelKey);

                        //Generate policies for all blueprints (skip the ones with custom implementations)
                        //todo: put that in configuration
                        var actions = ['find', 'findOne', 'create', 'update', 'destroy'];

                        //Check if there is a matching policy for this model/controller
                        var controllerPolicy = sails.config.policies[sails.controllers[modelKey].globalId + 'Controller'];
                        if (!controllerPolicy) {
                            sails.config.policies[sails.controllers[modelKey].globalId + 'Controller'] = {
                                '*': core.getModelRestrictionHandler()
                            };
                        }
                        else {
                            _.forEach(actions, function (action, index) {
                                if (!controllerPolicy[action]) {
                                    controllerPolicy[action] = core.getModelRestrictionHandler();
                                }
                                else {                                    
                                    if (!_.isArray(controllerPolicy[action]))
                                        controllerPolicy[action] = [controllerPolicy[action]];

                                    //Join policies
                                    controllerPolicy[action].push(core.getModelRestrictionHandler());
                                }
                            });
                        }
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
                    modelBased[modelKey][roleKey] = role.models[modelKey];
                });
            }
        });

        sails.config.roles = sails.config.roles || {};
        sails.config.roles._context = roleCtx;
        sails.config.roles.models = modelBased;

        // 4. Store role based access in sails.roles
        sails.roles = roles;
    },

    patchDeferred: function (Deferred) {
        //monkey patching the deferred is probably not a good idea.. 
        //but as harmony proxies are not here yet.. well..
        Deferred.prototype.execWithRoleFilter = function (request, cb) {
            //Do stuff first and modify select etc
            var model = this._context.__proto__.identity;
            var self = this;

            //Calculate restrictions & check
            core.calculateModelRestrictions(request, model, function (skip, restrictRoles, modelRestrictions) {

                if (skip)
                    return self.exec(cb);

                var restrictValues = [];
                _.forEach(modelRestrictions, function (values, key) {

                    //Check for special cases 
                    if (_.contains(values, 'readonly') && _.contains(values, 'restrict'))
                        _.remove(values, function (attr) { return attr === 'readonly' });

                    _.forEach(values, function (property) {
                        switch (property) {
                            case 'readonly':
                                core.processReadOnly(self, request, key);
                                break;
                            case 'hidden':
                                //Not supported yet, we'll need the .omit stuff in criteria
                                break;
                            case 'restrict':
                                restrictValues.push(key);
                                break;
                        }
                    });
                });

                //Process restrictions
                core.processRestrict(self, request, model, restrictRoles, restrictValues, function (err) {
                    if (err)
                        return cb('Request role filter threw error: ' + err);

                    self.exec(cb);
                });
            });
        };
    }
};

module.exports = logicFunctions;