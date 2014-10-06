module.exports = {

    applyModelRestrictions: function (request, response, inferRoles, restrictions, cbk) {
        //Prepare request
        request.options.values = request.options.values || {};
        request.options.values.blacklist = request.options.values.blacklist || [];
        var inferValues = [];
        _.forEach(restrictions, function (values, key) {

            //Check for special cases 
            if (_.contains(values, 'readonly') && _.contains(values, 'infer'))
                _.remove(values, function (attr) { return attr === 'readonly' });

            _.forEach(values, function (property) {

                //Actually: check which method -> create update need to call "check"
                //                                get           need to call "infer"
                switch (property) {
                    case 'readonly':
                        req.options.values.blacklist.push(key);
                        break;
                    case 'hidden':
                        //Not supported yet, we'll need the .omit stuff in criteria
                        break;
                    case 'infer':
                        inferValues.push(key);
                        break;
                }
            });
        });

        if (inferValues.length > 0) {
            //Cluster by role
            var valuesByRole = {};
            _.forEach(inferRoles, function (value, key) {

                if (!valuesByRoles[key])
                    valueByRoles[key] = [];

                _.forEach(inferValues, function (attr, index) {
                    if (_.contains(inferRoles[key], attr))
                        valuesByRoles[key].push(attr);
                });

            });

            var brk = false;
            var count = 0;
            _.forEach(valuesByRole, function (values, key) {
                //Call role to get new inferred value
                sails.roles[key].checkAndInfer(request, request.options.model, values, function (err, inferredValues) {

                    count++;

                    //If any request failed already
                    if (brk)
                        return;

                    //If any of this fails, just quit
                    if (err) {
                        brk = true;
                        return cbk(err);
                    }

                    //Else, copy values to select options
                    _.forEach(inferredValues, function (attributeValue, key) {
                        request.options.where = _.assign({ key: attributeValue }, request.options.where);
                    });

                    if (count === _.keys(valuesByRole).length)
                        cbk();
                });
            });
        }
    },
        
    calculateModelRestrictions: function (request, model, cb) {
        if (!model)
            model = request.options.model;

        var modelRestrictions = sails.config.roles.models[model];
        if (modelRestrictions) {
            //Restrictions are present, now check if they apply to the current request.. 
            // For this, we need to get the current requests assigned roles
            // It's possible that we have this info cached already from above
            if (request._roles) {
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

                                if (modelRestrictions[value][attrKey] === 'infer' && !inferRoles[attrKey]) //This is potentially bad? Uses first role with infer param for derivation..
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
            }
            else {
            }
        }
        else {
            //No restriction known, just pass through
            cb(true);
        }
    }

}