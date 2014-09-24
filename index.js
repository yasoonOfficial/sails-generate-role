var _ = require('lodash');
 	
function rolePolicy (param) {
	//First, check which invocation we are dealing with..
	// {} => model restrictions
	// [] => multi role controller policy check
	// '' => single role controller policy check
	if(_.isArray(param) || _.isString(param)) {
		var roles = (_.isString(param)) ? [param] : param;
		return getControllerPolicyHandler(roles);
	}
	else if(_.isPlainObject(param)) {
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
						request.roles = assignedRoles;
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
			var modelRestrictions = sails.config.roles.models[request.options.model];
			if(modelRestrictions) {
				//Restrictions are present, now check if they apply to the current request.. 
				// For this, we need to get the current requests assigned roles
				// It's possible that we have this info cached already from above
				if(request.roles) {
					//Now, get the intersection of the existing restrictions and the assigned roles
					var restrictionKeys = _.keys(modelRestrictions);
					var intersectRoles = _.intersection(restrictionKeys, request.roles);
					
					//When there is no overlap => no restriction for current request, continue
					if(!intersectRoles || intersectRoles.length === 0) {
						next();
					}
					else {
						//There is at least one (but possibly multiple) role restrictions
						// Now it's necessary to apply the least strict one
						var restrictedAttrKeys = [];
						_.forEach(intersectRoles, function(value, index) {
							var restrictedAttr = _.keys(modelRestrictions[value]);
							restrictedAttrKeys.push(restrictedAttr);
						});
						
						//Attributes which have no counterpart in the other arrays are ok 
						// => no restriction
						var commonAttrKeys = _.intersection.apply(_, restrictedAttrKeys);
						
						//When no common attributes are found => we are ok
						if(!commonAttrKeys || commonAttrKeys.lenght === 0) {
							next();
						}
						else {
							//Now, we only need to determine the attributes for the model
							// Collect properties for each attribute
							var modelAttributeRestrictions = {};
							var inferRoles = {};
							_.forEach(intersectRoles, function(value, index) {
								._forEach(commonAttrKeys, function(attrKey, index) {
									if(!modelAttributeRestrictions[attrKey])
										modelAttributeRestrictions[attrKey] = [];
									
									if(modelRestrictions[value][attrKey] === 'infer' && !inferRoles[attrKey]) //This is potentially bad? Uses first role with infer param for derivation..
										inferRoles[attrKey] = value;
									
									modelAttributeRestrictions[attrKey].push(modelRestrictions[value][attrKey]);
								});
							});
							
							//Strip out duplicates (eg. ["hidden", "hidden"])
							_.forEach(modelAttributeRestrictions, function(value, key) {
								modelAttributeRestrictions[key] = _.uniq(modelAttributeRestrictions[key], function(attr) { return attr.toLowerCase(); });
							});
							
							//Finally, process stuff => strip params from request etc.
							applyModelRestrictions(request, response, inferRoles, modelAttributeRestrictions, function(err) {
								next(err);
							});
						}
					}
				}
				else {
				}
			}
			else {
				//No restriction known, just pass through
				next();
			}
		}
		else {
			//Nothing to do, controller route, just continue
			next();
		}
	};
}

function applyModelRestrictions(request, response, inferRoles, restrictions, cbk) {
	//Prepare request
	request.options.values = request.options.values || {};
	request.options.values.blacklist = request.options.values.blacklist || [];
	var inferValues = [];
	_.forEach(restrictions, function(values, key) {
		
		//Check for special cases 
		if(_.contains(values, 'readonly') && _.contains(values, 'infer')) 
			_.remove(values, function(attr) { return attr === 'readonly' });
			
		_.forEach(values, function(property) {
			
			switch(property) {
				case: 'readonly':
					req.options.values.blacklist.push(key);
					break;
				case: 'hidden':
					//Not supported yet, we'll need the .omit stuff in criteria
					break;
				case 'infer': 
					inferValues.push(key);
					break;
			}
			
		});
	});
	
	if(inferValues.length > 0) {
		//Cluster by role
		var valuesByRole = {};
		_.forEach(inferRoles, function(value, key) {
			
			if(!valuesByRoles[key])
				valueByRoles[key] = [];
				
			_.forEach(inferValues, function(attr, index) {				
				if(_.contains(inferRoles[key], attr))
					valuesByRoles[key].push(attr);				
			});
			
		});
		
		var brk = false;
		var count = 0;
		_.forEach(valuesByRole, function(values, key) {
			//Call role to get new inferred value
			sails.roles[key].checkAndInfer(request, request.options.model, values, function(err, inferredValues) {
				
				count++;
				
				//If any request failed already
				if(brk)
					return;
					
				//If any of this fails, just quit
				if(err) {
					brk = true;
					return cbk(err);
				}
				
				//Else, copy values to select options
				_.forEach(inferredValues, function(attributeValue, key) {
					request.options.where = _.assign({key : attributeValue}, request.options.where);		
				});	

				if(count === _.keys(valuesByRole).length)
					cbk();
			});
		});
	}
}

module.exports = rolePolicy;