var _ = require('lodash');
var core = require('lib/functions');
    
function rolePolicy(param) {

    //First, check which invocation we are dealing with..
    // {} => model restrictions
    // [] => multi role controller policy check
    // '' => single role controller policy check
    if(_.isArray(param) || _.isString(param)) {
        var roles = (_.isString(param)) ? [param] : param;
        return core.getControllerPolicyHandler(roles);
    }
    //Not really used atm, as calls are build in hook, but for future architecture changes
    // Leave this option
    else if (_.isPlainObject(param)) {
        return param;//getModelRestrictionHandler(param);
    }
    
    throw "Not supported parameter value";
}

module.exports = rolePolicy;