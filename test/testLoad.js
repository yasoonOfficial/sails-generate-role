var assert = require('assert')
var hookLogic = require('../lib/hookLogic');
var _ = require('lodash');

describe('Roles', function () {
    describe('#loadRoles()', function () {
        it('should load roles correctly into sails runtime', function () {

            sails = {};
            sails.config = {};
            sails.config.policies = {
                AppController: {
                    find: true,
                    findAll: 'isAuthed'
                },

                App: {
                    'admin': {
                        'name': 'readonly', //Will disallow any change of this attribute for partners
                        'companyId': 'restrict' //Will call "infer" function of role object
                    }
                }
            };
            sails.models = {
                app: {
                    id: 'integer',
                    name: 'string',
                    companyId: 'integer'
                }
            };

            sails.controllers = {
                app: {
                    globalId: 'App',
                    identity: 'app'
                }
            };

            var AdminRole = {
                models: {
                    App: {
                        id: 'readonly'
                    }
                },
                controllers: {
                    AppController: {
                        someMethod: true,
                        find: true
                    }
                },
                hasRole: function (request, cbk) {

                }
            };
                        
            //Do logic
            hookLogic.attachRoles({ 'admin': AdminRole }, { resolveRoles: function () { } });

            //Check model was removed from policies
            assert(!sails.config.policies.App);

            //Check controller policies were merged correctly
            assert(sails.config.policies.AppController);
            assert(sails.config.policies.AppController.someMethod);
            assert(_.isArray(sails.config.policies.AppController.find) && sails.config.policies.AppController.find.length === 3);

            //Check models were merged correctly
            assert(sails.roles.admin);
            assert(sails.roles.admin.models.app.id);
            assert(sails.roles.admin.models.app.name);
        });

        it('should throw an error if the context is missing the resolveRoles function', function () {
            //Check for invalid role behaviour
            assert.throws(function () { hookLogic.attachRoles({ 'dummy': {} }, {}) }, /resolveRoles/);
        });

        it('should throw an error if a role in policies.js is not defined in /roles/', function () {
            sails = {};
            sails.config = {};
            sails.config.policies = {
                App: {
                    'admin': {
                        'name': 'readonly', //Will disallow any change of this attribute for partners
                        'companyId': 'restrict' //Will call "infer" function of role object
                    }
                }
            };
            sails.models = {
                app: {
                    id: 'integer',
                    name: 'string',
                    companyId: 'integer'
                }
            };
            
            assert.throws(function () { hookLogic.attachRoles({}, { resolveRoles: function () { } }) }, /exist/);
        });
    });
});