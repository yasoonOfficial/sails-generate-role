var _ = require('lodash');
var core = require('lib/functions');
    
function rolePolicy(param) {

    //First, check which invocation we are dealing with..
    // {} => model restrictions
    // [] => multi role controller policy check
    // '' => single role controller policy check
    if(_.isArray(param) || _.isString(param)) {
        var roles = (_.isString(param)) ? [param] : param;
        return getControllerPolicyHandler(roles);
    }
    else if (_.isPlainObject(param)) {
        return getModelRestrictionHandler(param);
    }
    
    throw "Not supported parameter value";
}

function getControllerPolicyHandler(roles) {
    return function(request, response, next) {
        //Check the given roles against the role objects 
        var assignedRoles = [];
        var cacheRoles = request.options.model && sails.config.roles.models[request.options.model];
        
        var processRole = function(roleIndex) {
            var roleId = roles[roleIndex];
            var role = sails.roles[roleId];
            var lastErr;
            //The existence of checkRole is already validated on load
            role.checkRole(request, function(err) {
                //If this request is based on a model and a restriction exist, cache the assigned
                // roles for later processing => attach to request
                // Otherwise, as the roles are OR'd, we can now stop evaluating the other roles
                if(!err && !cacheRoles) {
                    return next();
                }
                else if(!err && cacheRoles) {
                    assignedRoles.push(roleId);
                }
                else if(err) {
                    //Otherwise, save lastErr, this will be send to sails if no valid role comes later
                    lastErr = err;
                }
                
                //Check if more roles are available
                if(roleIndex < (roles.length - 1)) {
                    processRole(roleIndex + 1);
                }
                else {
                    //Get back to sails processing
                    if(assignedRoles.length > 0) {
                        request._roles = assignedRoles;
                        next();
                    }
                    else {
                        next(lastErr);
                    }
                }
            });
        };
        
        processRole(0);
    };
}

function getModelRestrictionHandler(restrictions) {
    return function(request, response, next) {
        //First, check if this request is interesting for us (model request)
        if(request.options.model /* && request.options.rest */) { //rest => overwritten blueprint, include them for now
            //Determine if the model has restrictions defined!
            core.calculateModelRestrictions(request, null, function (skip, inferRoles, modelAttributeRestrictions) {

                if(skip)
                    return next();

                //Finally, process stuff => strip params from request etc.
                core.applyModelRestrictions(request, response, inferRoles, modelAttributeRestrictions, function(err) {
                    next(err);
                });
            });
        }
        else {
            //Nothing to do, controller route, just continue
            next();
        }
    };
}

module.exports = rolePolicy;