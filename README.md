# sails-generate-role

A role generator for use with the Sails command-line interface.

Roles allow you to specify access restrictions based on roles. This includes normal controller access via policies as well as model restrictions.

See usage section for more details.

### Installation

```sh
$ npm install sails-generate-role
```


### Usage

#### On the command line

The plugin (via a Sails hook) is initialized when the first role is generated. For example, to start with an admin role, do the following:

```sh
$ sails generate role Admin
```

#### Concepts

Please note that this is work in progress. Some of the options described below may not work yet.
Todo: Detail 'readonly' and 'restrict' behaviour.

#### In your code

The role restrictions can be defined in two different ways. The first is to use the policies.js, located in the sails project (config/policies.js).
It's recommended to use this if you already have a lot of policies and don't want to migrate to the role based layout.

In addition, it is necessary to implement the method 'resolveRoles' of the api/roles/RoleContext.js.
This will allow the role framework to look up all roles for a given request.

##### Via policies.js

config/policies.js
```js
var rolePolicy = require('sails-generate-role').rolePolicy;

module.exports = {
    //Restrict partnerId attribute on model app to read-only for users with role partner
    // This would remove the partnerId from all update/create calls to blueprint REST services
    // If you want more control (e.g. overwrite a value), use 'restrict'
    App: rolePolicy({
        'partner': {
            'partnerId': 'readonly'
        }
    }),

    //Controller policies can be combined with standard policies:
    // Only allow logged in users with admin OR partner role to access the find action
    AppController: {
        find: ['isLoggedIn', rolePolicy(['admin', 'partner'])]
    }
};
```

##### Via *Role.js

The other possibility is to specify all policies and model restrictions in the role itself (e.g. api/roles/AdminRole.js).

config/policies.js
```js
var rolePolicy = require('sails-generate-role').rolePolicy;
module.exports = {    
    '*': ['isLoggedIn', rolePolicy('admin')] //Disallow for everyone except admin
}
```

api/roles/PartnerRole.js
```js
module.exports = {    
    
    //Allow access to specific actions
    controllers: {
        AppController: {
            find: true,
            findOne: true
        }
    },

    models: {
        App: {
            'partnerId': 'restrict'
        }
    },

    restrictCriteria: function(request, model, roleValues, criteria, next) {
        //No additional restrictions, modify criteria as necessary
        next(null, criteria);
    },

    restrictValues: function(request, model, valueObj, next) {
        //No additional restrictions, modify values as necessary
        next(null, valueObj);
    }
}
```

### License

**[MIT](./LICENSE)**
&copy; 2014 [yasoon](http://github.com/yasoonOfficial) & contributors
