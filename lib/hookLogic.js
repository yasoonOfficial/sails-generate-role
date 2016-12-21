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
        
        //1. Process Model restrictions in Roles
        var addedModels = [];
        var globalFallbackPolicy = sails.config.policies['*'] || [];

        _.forEach(roles, function (role, roleKey) {
            if (role.models) {
                _.forEach(role.models, function (model, modelKey) {
                    //Check if policies for current model were already registered
                    if (!_.contains(addedModels, modelKey) && sails.controllers[modelKey]) {
                        addedModels.push(modelKey);

                        //Generate policies for all blueprints (skip the ones with custom implementations)
                        //todo: put that in configuration
                        var actions = ['find', 'create', 'update', 'destroy'];

                        //Check if there is a matching policy for this model/controller
                        var controllerPolicy = sails.config.policies[sails.controllers[modelKey].globalId + 'Controller'];
                        var localFallbackPolicy = globalFallbackPolicy;
                        
                        //Check if there is a local * rule for the controller, if so, this will be the fallback
                        if (controllerPolicy && controllerPolicy['*'])
                            localFallbackPolicy = controllerPolicy['*'];

                        //Convert to array if necessary
                        if (!_.isArray(localFallbackPolicy))
                            localFallbackPolicy = [localFallbackPolicy];

                        //The new fallback value will always include the restriction handler for the current model
                        localFallbackPolicy.push(core.getModelRestrictionHandler());

                        if (!controllerPolicy) {
                            sails.config.policies[sails.controllers[modelKey].globalId + 'Controller'] = {
                                '*': localFallbackPolicy
                            };
                        }
                        else {
                            _.forEach(actions, function (action, index) {
                                if (!controllerPolicy[action]) {
                                    controllerPolicy[action] = localFallbackPolicy;
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

        // 2. Store model based access in sails.config.roles.models
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

		//Hacky: Rebuild sails policy map... Todo: Find a nicer way
		sails.hooks.policies.mapping = sails.hooks.policies.buildPolicyMap();
		
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