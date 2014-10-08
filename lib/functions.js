var _ = require('lodash');

var functions = {
    
    getControllerPolicyHandler: function getControllerPolicyHandler(roles) {
        return function(request, response, next) {
        
            sails.config.roles._context.resolveRoles(request, function (requestRoles) {

                var overlapping = _.intersection(roles, requestRoles);
                if (overlapping.length > 0) {
                    next();
                }
                else {
                    next('Request is not assigned to any allowed role. Allowed: [' + roles.toString() + '], Actual: [' + requestRoles.toString() + ']');
                }

            });

        };
    },

    getRestrictedFindOne: function(model) {
        return function(request, response) {
            var Model = sails.models[model.toLowerCase()];
            Model.find({id : request.params.id })
             .execWithRoleFilter(request, function(err, results) {
                 if (err)
                     return response.send(500);
        
                 if(results.length === 0)
                     return response.send(404);

                 return response.ok(results[0]);
             });
        };
    },
    
    getModelRestrictionHandler: function getModelRestrictionHandler() {
        return function (request, response, next) {
            //First, check if this request is interesting for us (model request)
            if (request.options.model) { //We can only process this if model is found (should be the case every time..)
                //Determine if the model has restrictions defined!
                var model = request.options.model;
                functions.calculateModelRestrictions(request, model, function (skip, restrictRoles, modelRestrictions) {

                    if (skip)
                        return next();

                    var restrictValues = [];
                    _.forEach(modelRestrictions, function (values, key) {

                        //Check for special cases 
                        if (_.contains(values, 'readonly') && _.contains(values, 'restrict'))
                            _.remove(values, function (attr) { return attr === 'readonly' });

                        _.forEach(values, function (property) {
                            switch (property) {
                                case 'readonly':
                                    core.processReadOnly(null, request, key);
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
                    functions.processRestrict(null, request, model, restrictRoles, restrictValues, function (err) {
                        if (err)
                            return cb('Request role filter threw error: ' + err);

                        next();
                    });
                });
            }
            else {
                //Nothing to do, controller route, just continue
                next();
            }
        };
    },

    findRoles: function(request, cb) {
        sails.config.roles._context.resolveRoles(request, function (roles) {
            request._roles = roles;
            cb();
        });               
    },

    calculateModelRestrictions: function (request, model, cb) {

        var modelRestrictions = sails.config.roles.models[model];
        if (modelRestrictions) {
            //Restrictions are present, now check if they apply to the current request.. 
            // For this, we need to get the current requests assigned roles
            // It's possible that we have this info cached already from above
            var logic = function () {
                //Now, get the intersection of the existing restrictions and the assigned roles
                var restrictionKeys = _.keys(modelRestrictions);
                var intersectRoles = _.intersection(restrictionKeys, request._roles);

                //When there is no overlap => no restriction for current request, continue
                if (!intersectRoles || intersectRoles.length === 0) {
                    cb(true);
                }
                else {
                    //There is at least one (but possibly multiple) role restrictions
                    // Now it's necessary to apply the least strict one
                    var restrictedAttrKeys = [];
                    _.forEach(intersectRoles, function (value, index) {
                        var restrictedAttr = _.keys(modelRestrictions[value]);
                        restrictedAttrKeys.push(restrictedAttr);
                    });

                    //Attributes which have no counterpart in the other arrays are ok 
                    // => no restriction
                    var commonAttrKeys = _.intersection.apply(_, restrictedAttrKeys);

                    //When no common attributes are found => we are ok
                    if (!commonAttrKeys || commonAttrKeys.lenght === 0) {
                        cb(true);
                    }
                    else {
                        //Now, we only need to determine the attributes for the model
                        // Collect properties for each attribute
                        var modelAttributeRestrictions = {};
                        var inferRoles = {};
                        _.forEach(intersectRoles, function (value, index) {
                            _.forEach(commonAttrKeys, function (attrKey, index) {
                                if (!modelAttributeRestrictions[attrKey])
                                    modelAttributeRestrictions[attrKey] = [];

                                if (modelRestrictions[value][attrKey] === 'restrict' && !inferRoles[attrKey]) //This is potentially bad? Uses first role with infer param for derivation..
                                    inferRoles[attrKey] = value;

                                modelAttributeRestrictions[attrKey].push(modelRestrictions[value][attrKey]);
                            });
                        });

                        //Strip out duplicates (eg. ["hidden", "hidden"])
                        _.forEach(modelAttributeRestrictions, function (value, key) {
                            modelAttributeRestrictions[key] = _.uniq(modelAttributeRestrictions[key], function (attr) { return attr.toLowerCase(); });
                        });

                        cb(false, inferRoles, modelAttributeRestrictions);
                    }
                }
            };

            if (!request._roles) {
                functions.findRoles(request, logic);
            }
            else {
                logic();
            }                
        }
        else {
            //No restriction known, just pass through
            cb(true);
        }
    },
    
    processReadOnly: function processReadOnly(deferred, request, key) {
        //Create or update, possibilities include:
        // A) Blacklisting / New / Changed criteria 
        // B) Blacklisting / New / Changed values
        // C) Error
        // ==> Request mode
        if (!deferred) {
            //For these, put given value to blacklist if it's provided
            if (request.method === 'PUT' || request.method === 'POST') {
                if (request.params.all()[key]) {
                    request.options.values = request.options.values || {};
                    request.options.values.blacklist = request.options.values.blacklist || [];
                    request.options.values.blacklist = _.union(request.options.values.blacklist, [key]);
                }
            }
        }
        else {
            if (deferred._values) {
                if (_.has(deferred._values, key))
                    delete deferred._values[key];
            }
            else {
                //Delete & Fetch do not have restrictions for read-only values
            }
        }
    },

    processRestrict: function processRestrict(deferred, request, model, restrictRoles, restrictValues, cb) {
        var fromDeferredApi = !_.isNull(deferred);
        var values = fromDeferredApi ? deferred._values : request.params.all();
        var criteria = fromDeferredApi ? (deferred._criteria.where || {}) : (request.params.all().where || {});

        // If `where` parameter is a string, try to interpret it as JSON
        if (_.isString(criteria)) {
            criteria = JSON.parse(criteria);
        }

        var isCreateUpdate = fromDeferredApi ? !!values : (request.method === 'PUT' || request.method === 'POST');

        if (restrictValues.length > 0) {
            //Cluster by role
            var valuesByRole = {};
            _.forEach(restrictRoles, function (value, key) {

                if (!valuesByRole[value])
                    valuesByRole[value] = [];

                valuesByRole[value].push(key);
            });

            var brk = false;
            var count = 0;
            var chooseEmpty = function (value, key, obj) { return _.isNull(value) || _.isUndefined(value) };
            var keys = _.keys(valuesByRole);
            var endIt = false;

            for (var i = 0; i < keys.length && !endIt; i++) {
                var key = keys[i];
                var roleValues = valuesByRole[key];

                var restrictCriteria = function () {
                    var oldCriteria = _.clone(criteria);
                    sails.roles[key].restrictCriteria(request, model, roleValues, criteria, function (err, newCriteria) {

                        //If this errors, fail all
                        if (err) {
                            endIt = true;
                            return cb(err);
                        }

                        var added = _.pick(newCriteria, function (value, key) { return !_.has(oldCriteria, key) });
                        var changed = _.pick(newCriteria, function (value, key) { return _.has(oldCriteria, key) && oldCriteria[key] != value });
                        var removed = _.keys(_.pick(oldCriteria, function (value, key) { return !_.has(newCriteria, key) }));

                        if (fromDeferredApi) {
                            //Mix up values
                            //1. Added => just add to list
                            deferred._criteria.where = _.assign(deferred._criteria.where || {}, added);

                            //2. Changed => add to blacklist & overwrite
                            _.assign(deferred._criteria.where, changed);

                            //3. Remove removed ;)
                            deferred._criteria.where = _.omit(deferred._criteria.where, removed);
                        }
                        else {
                            request.options.where = request.options.where || {};
                            request.options.criteria = request.options.criteria || {};
                            request.options.criteria.blacklist = request.options.criteria.blacklist || [];
                            //Mix up values
                            //1. Added => just add to list
                            _.assign(request.options.where, added);

                            //2. Changed => add to blacklist & overwrite
                            request.options.criteria.blacklist = _.union(request.options.criteria.blacklist, _.keys(changed));
                            _.assign(request.options.where, changed);

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
                    var oldValues = _.clone(valueObj);
                    sails.roles[key].restrictValues(request, model, valueObj, function (err, newValues) {

                        //If this errors, fail all
                        if (err) {
                            endIt = true;
                            return cb(err);
                        }

                        //Now, compare to old values and process changes
                        //1. null/missing values will be blacklisted
                        var cleared = _.keys(_.pick(newValues, chooseEmpty));
                        var added = _.keys(_.pick(newValues, function (value, key) { return !_.has(oldValues, key) }));
                        var changed = _.keys(_.pick(newValues, function (value, key) { return _.has(oldValues, key) && !_.contains(cleared, key) && oldValues[key] != value }));
                        var removed = _.keys(_.pick(oldValues, function (value, key) { return !_.has(newValues, key) }));
                        var blacklist = _.union(cleared, removed);

                        if (fromDeferredApi) {
                            deferred._values = _.omit(deferred._values, blacklist);
                            _.assign(deferred._values, _.merge(_.pick(newValues, added), _.pick(newValues, changed)));
                        }
                        else {
                            request.options.values = request.options.values || {};
                            request.options.values.blacklist = request.options.values.blacklist || [];
                            _.assign(request.options.values, _.merge(_.pick(newValues, added), _.pick(newValues, changed)));
                            request.options.values.blacklist = _.union(request.options.values.blacklist, blacklist);
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
        else {
            cb();
        }
    }
};

module.exports = functions;