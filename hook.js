var buildDictionary = require('../../../node_modules/sails/node_modules/sails-build-dictionary');
var Deferred = require('../../../node_modules/sails/node_modules/waterline/lib/waterline/query/deferred');
var _ = require('../../../node_modules/sails/node_modules/lodash/lodash');
var roleUtil = require('../../../node_modules/sails-generate-role');

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
                    var self = this;

                    //Calculate restrictions & check
                    roleUtil.calculateModelRestrictions(request, model, function (skip, restrictRoles, modelRestrictions) {

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
                                        processReadOnly(self, key);
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
                        processRestrict(self, model, restrictRoles, restrictValues, function (err, lala, lala2) {
                            if (err)
                                return cb('Request role filter threw error: ' + err);

                            self.exec(cb);
                        });
                    });

                };
            });

            sails.after('hook:orm:loaded', function () {
                console.log("orm loaded");
            });

            next();
        }
    };
};

function processReadOnly(deferred, key) {
    //Create or update, possibilities include:
    // A) Blacklisting / New / Changed criteria 
    // B) Blacklisting / New / Changed values
    // C) Error
    if (deferred._values) {
        if (_.contains(deferred._values, key))
            delete deferred._values[key];
    }
    else {
        //Delete & Fetch do not have restrictions for read-only values
    }
}

function processRestrict(deferred, request, model, restrictRoles, restrictValues, cb) {
    var valueChangePossible = !_.isNull(deferred);
    var values = valueChangePossible ? deferred._values : request.params.all();
    var criteria = valueChangePossible ? deferred._criteria : request.params.all().where;

    // If `where` parameter is a string, try to interpret it as JSON
    if (_.isString(criteria)) {
        criteria = JSON.parse(criteria);
    }

    var isCreateUpdate = valueChangePossible ? !!values : (request.method === 'PUT' || request.method === 'POST');

    if (restrictValues.length > 0) {
        //Cluster by role
        var valuesByRole = {};
        _.forEach(restrictRoles, function (value, key) {

            if (!valuesByRoles[key])
                valueByRoles[key] = [];

            _.forEach(restrictValues, function (attr, index) {
                if (_.contains(restrictRoles[key], attr))
                    valuesByRoles[key].push(attr);
            });

        });

        var brk = false;
        var count = 0;
        var chooseEmpty = function (value) { return _.isNull(value) || _.isUndefined(value) };
        var keys = _.keys(valuesByRole);
        var endIt = false;

        for (var i = 0; i < keys.length && !endIt; i++) {
            var key = keys[i];
            var roleValues = valuesByRole[key];

            var restrictCriteria = function () {
                sails.roles[key].restrictCriteria(request, model, roleValues, criteria, function (err, newCriteria) {

                    //If this errors, fail all
                    if (err) {
                        endIt = true;
                        return cb(err);
                    }

                    var added = _.pick(newCriteria, function (value, key) { return !_.has(criteria, key) });
                    var changed = _.pick(newCriteria, function (value, key) { return _.has(criteria, key) && criteria[key] != value });
                    var removed = _.keys(_.pick(criteria, function (value, key) { return !_.has(newCriteria, key) }));

                    if(valueChangePossible) {
                        //Mix up values
                        //1. Added => just add to list
                        _.assign(deferred._criteria, added);

                        //2. Changed => add to blacklist & overwrite
                        _.assign(deferred._criteria, changed);

                        //3. Remove removed ;)
                        deferred._criteria = _.omit(deferred._criteria, removed);
                    }
                    else {
                        request.options.where = request.options.where || {};
                        request.options.criteria.blacklist = request.options.criteria.blacklist || [];
                        //Mix up values
                        //1. Added => just add to list
                        _.assign(request.options.where, added);

                        //2. Changed => add to blacklist & overwrite
                        request.options.criteria.blacklist = _.union(request.options.criteria.blacklist, _.keys(changed));
                        _assign(request.options.where, changed);

                        //3. Put removed to blacklist as well
                        request.options.criteria.blacklist = _.union(request.options.criteria.blacklist, removed);
                    }
                
                    if (i === (keys.length - 1)) {
                        cb();
                    }
                });
            };

            //If put/post -> additionally process value restrictions
            if (isCreateUpdate) {
                var valueObj = _.omit(_.pick(values, roleValues), chooseEmpty);
                sails.roles[key].restrictValues(request, model, valueObj, function (err, newValues) {

                    //If this errors, fail all
                    if (err) {
                        endIt = true;
                        return cb(err);
                    }

                    //Now, compare to old values and process changes
                    //1. null/missing values will be blacklisted
                    var cleared = _.keys(_.pick(newValues, chooseEmpty));
                    var added = _.keys(_.pick(newValues, function (value, key) { return !_.has(valueObj, key) }));
                    var changed = _.keys(_.pick(newValues, function (value, key) { return _.has(valueObj, key) && !_.contains(cleared, key) && valueObj[key] != value }));
                    var removed = _.keys(_.pick(valueObj, function (value, key) { return !_.has(newValues, key) }));
                    var blacklist = _.union(cleared, removed);

                    if (valueChangePossible) {
                        deferred._values = _.omit(deferred._values, blacklist);
                        _.assign(deferred._values, _.merge(_.pick(newValues, added), _.pick(newValues, changed)));
                    }
                    else {
                        request.options.values = request.options.values || {};
                        request.options.values.blacklist = request.options.values.blacklist || [];
                        _.assign(request.options.values, _.merge(_.pick(newValues, added), _.pick(newValues, changed)));
                        req.options.values.blacklist = _.union(req.options.values.blacklist, blacklist);
                    }

                    //Finally, restrict criteria
                    restrictCriteria();
                });
            }
            else {
                restrictCriteria();
            }
        }
    }
}