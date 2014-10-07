var assert = require('assert')
var hookLogic = require('../lib/hookLogic');
var _ = require('lodash');

describe('Roles', function () {
    describe('#execWithRole()', function () {
        it('should load roles correctly into sails runtime', function (done) {

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

                },

                restrictValues: function (request, model, valueObj, cb) {
                    valueObj.companyId = '1234';
                    cb(null, valueObj);
                },

                restrictCriteria: function (request, model, roleValues, criteria, cb) {
                    cb(null, criteria);
                }
            };
                        
            //Do logic
            hookLogic.attachRoles({ 'admin': AdminRole }, { resolveRoles: function () { } });

            //Build up deferred
            var Deferred = function () { };
            var Ctx = function () { };
            var deferred = new Deferred();
            deferred.exec = function (cb) { cb(); };
            deferred._context = new Ctx();
            deferred._values = {
                id: 'lala',
                companyId: '123'
            };
            deferred._criteria = {};
            
            //Patch in execWithRole
            hookLogic.patchDeferred(Deferred);
            assert(deferred.execWithRoleFilter);

            //Build up fake request
            var request = {
                _roles: ['admin']
            };
            
            //Call
            deferred._context.__proto__.identity = 'app';
            deferred.execWithRoleFilter(request, function (err, stuff) {
                //Check that readonly restriction was applied
                assert(!deferred._values.id);
                assert(deferred._values.companyId === '1234');
                done();
            });
        });

    });
});