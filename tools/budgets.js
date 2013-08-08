/**
 * PaySwarm budgets tool.
 *
 * Copyright (c) 2011-2013, Digital Bazaar, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of Digital Bazaar, Inc. nor the names of its contributors
 *   may be used to endorse or promote products derived from this software
 *   without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var URL = require('url');
var async = require('async');
var common = require('./common');
var fs = require('fs');
var jsonld = require('./jsonld');
var payswarm = require('..');
var prompt = require('prompt');
var util = require('util');

function init(options) {
  var cmd = options.program
    .command('budgets [budget]')
    .description('manage budgets');
  common
    .command
    .init(cmd)
    .option('    --identity <identity>', 'identity to use [access key owner]')
    .option('-l, --list', 'list budgets [default]')
    .option('    --create', 'create new budget')
    .option('    --delete', 'delete budget')
    .option('    --label <label>', 'personal label')
    .option('    --source <source>', 'source account')
    .option('    --amount <amount>', 'maximum amount')
    //.option('    --balance <balance>', 'current balance')
    .option('    --max-per-use <max-per-use>', 'maximum per use')
    .option('    --refresh-interval <refresh-interval>', 'refresh interval')
    .option('    --validity-interval <validity-interval>', 'validity interval')
    .option('    --add-vendor <vendor>', 'add vendor to budget')
    .option('    --delete-vendor <vendor>', 'delete vendor from budget')
    .action(budgets)
    .on('--help', function() {
      //console.log();
      // FIXME: add interval help (P1D, PT1H, etc)
    });
}

function budgets(budget, cmd) {
  var single = (typeof budget !== 'undefined');
  async.auto({
    init: function(callback, results) {
      cmd.list = !!cmd.list;
      cmd.create = !!cmd.create;

      var count = (single + cmd.list + cmd.create);
      if(count > 1) {
        return callback(new Error('Only one command at a time allowed.'));
      }

      // default to list
      if(count ===  0) {
        cmd.list = true;
      }

      callback(null);
    },
    single: ['init', function(callback, results) {
      if(!single) {
        return callback(null);
      }

      var update =
        cmd.label ||
        cmd.source ||
        cmd.amount ||
        //cmd.balance ||
        cmd.maxPerUse ||
        cmd.refreshInterval ||
        cmd.validityInterval;

      if(update && cmd.delete) {
        return callback(
          new Error('Can not delete and update at the same time.'));
      }

      if(cmd.addVendor && cmd.deleteVendor) {
        return callback(
          new Error('Only one vendor update at a time allowed.'));
      }

      if(cmd.delete) {
        _delete(cmd, budget, callback);
      }
      else if(update) {
        _update(cmd, budget, callback);
      }
      else if(cmd.addVendor || cmd.deleteVendor) {
        _vendors(cmd, budget, callback);
      }
      else {
        _list(cmd, budget, callback);
      }
    }],
    list: ['init', function(callback, results) {
      if(!cmd.list) {
        return callback(null);
      }
      _list(cmd, null, callback);
    }],
    create: ['init', function(callback, results) {
      if(!cmd.create) {
        return callback(null);
      }
      _create(cmd, callback);
    }]
  }, function(err) {
    common.error(err);
  });
}

function _list(cmd, budget, callback) {
  async.waterfall([
    function(callback) {
      common.config.read(cmd, callback);
    },
    function(cfg, callback) {
      // default id to key owner from config
      cmd.identity = cmd.identity || cfg.owner;

      if(!cmd.identity) {
        return callback(new Error('No id or key owner found.'));
      }

      var url = common.makeId(cmd.identity + '/budgets', budget);
      // FIXME: check cross authority id

      var requestOptions = {
        _httpSignatureFromConfig: cfg
      };

      common.request(cmd, url, requestOptions, callback);
    },
    function(res, result, callback) {
      common.output(cmd, result, callback);
    }
  ], function(err) {
    common.error(err);
    callback();
  });
}

function _create(cmd, callback) {
  async.auto({
    config: function(callback) {
      // read the config file
      common.config.read(cmd, {strict: false}, callback);
    },
    budget: function(callback, results) {
      // create default budget
      var budget = {
        '@context': payswarm.CONTEXT_URL,
        'type': 'Budget',
        // options to be filled in by command line or prompts:
        'label': cmd.label,
        'source': cmd.source,
        'amount': cmd.amount,
        //'balance': cmd.balance,
        'psaMaxPerUse': cmd.maxPerUse,
        'psaRefreshInterval': cmd.refreshInterval,
        'psaValidityInterval': cmd.validityInterval
      };
      callback(null, budget);
    },
    identity: ['config', function(callback, results) {
      // default id to key owner from config
      var identity = cmd.identity || results.config.owner;

      if(!identity) {
        return callback(new Error('No id or key owner found.'));
      }

      callback(null, identity);
    }],
    url: ['identity', function(callback, results) {
      var url = common.makeId(results.identity + '/budgets');
      // FIXME: check cross authority id

      callback(null, url);
    }],
    budgetRequest: ['budget', 'id', function(callback, results) {
      var budget = results.budget;
      var props = [];
      if(!budget.label) {
        props.push({
          name: 'label',
          description: 'Private budget label',
          type: 'string',
          required: true
        });
      }
      if(!budget.source) {
        props.push({
          name: 'source',
          description: 'Account source (URL or short name)',
          type: 'string',
          required: true
        });
      }
      if(!budget.amount) {
        props.push({
          name: 'amount',
          description: 'Maximum amount',
          type: 'string',
          required: true
        });
      }
      if(!budget.psaMaxPerUse) {
        props.push({
          name: 'psaMaxPerUse',
          description: 'Maximum per use [budget maximum]',
          type: 'string',
          required: false
        });
      }
      if(!budget.psaRefreshInterval) {
        props.push({
          name: 'psaRefreshInterval',
          description: 'Refresh interval [never]',
          type: 'string',
          required: false
        });
      }
      if(!budget.psaValidityInterval) {
        props.push({
          name: 'psaValidityInterval',
          description: 'Validity interval [forever]',
          type: 'string',
          required: false
        });
      }

      prompt.start();
      prompt.addProperties(budget, props, function(err, results) {
        if(err) {
          return callback(err);
        }

        // ensure empty optional properties are removed
        var props = [
          'psaMaxPerUse',
          'psaRefreshInterval',
          'psaValidityInterval',
        ];
        props.forEach(function(key) {
          if(!budget[key]) {
            delete budget[key];
          }
        });

        budget.source =
          common.makeId(results.identity + '/accounts', budget.source);

        callback(null, budget);
      });
    }],
    create: ['budgetRequest', function(callback, results) {
      var requestOptions = {
        _httpSignatureFromConfig: results.config,
        method: 'POST',
        json: results.budgetRequest
      };

      common.request(cmd, results.url, requestOptions,
        function(err, res, result) {
          if(err) {
            return callback(err);
          }
          callback(null, {
            res: res,
            result: result
          });
        });
    }],
    output: ['create', function(callback, results) {
      console.log('Created new budget:');
      common.output(cmd, results.create.result, callback);
    }]
  }, function(err) {
    common.error(err);
    callback();
  });
}

function _delete(cmd, budget, callback) {
  async.waterfall([
    function(callback) {
      common.config.read(cmd, callback);
    },
    function(cfg, callback) {
      // default id to key owner from config
      cmd.identity = cmd.identity || cfg.owner;

      if(!cmd.identity) {
        return callback(new Error('No id or key owner found.'));
      }

      var url = common.makeId(cmd.identity + '/budgets', budget);
      // FIXME: check cross authority id

      var requestOptions = {
        _httpSignatureFromConfig: cfg,
        method: 'DELETE'
      };

      common.request(cmd, url, requestOptions, callback);
    },
    function(res, result, callback) {
      common.output(cmd, result, callback);
    }
  ], function(err) {
    common.error(err);
    callback();
  });
}

function _update(cmd, budget, callback) {
  async.auto({
    config: function(callback) {
      common.config.read(cmd, callback);
    },
    identity: ['config', function(callback, results) {
      // default id to key owner from config
      var identity = cmd.identity || results.config.owner;

      if(!identity) {
        return callback(new Error('No id or key owner found.'));
      }

      callback(null, identity);
    }],
    url: ['config', 'identity', function(callback, results) {
      var url = common.makeId(results.identity + '/budgets', budget);
      // FIXME: check cross authority id

      callback(null, url);
    }],
    budget: ['url', function(callback, results) {
      var requestOptions = {
        _httpSignatureFromConfig: results.config
      };

      common.request(cmd, results.url, requestOptions,
        function(err, res, result) {
          if(err) {
            return callback(err);
          }
          callback(null, {
            res: res,
            result: result
          });
        });
    }],
    update: ['budget', function(callback, results) {
      var updated = results.budget.result;
      delete updated.balance;
      delete updated.currency;
      delete updated.vendor;
      delete updated.owner;

      var props = {
        'amount': 'amount',
        //'balance': 'balance',
        'label': 'label',
        'maxPerUse': 'psaMaxPerUse',
        'refreshInterval': 'psaRefreshInterval',
        'validityInterval': 'psaValidityInterval',
        'source': 'source'
      }
      Object.keys(props).forEach(function(key) {
        if(key in cmd) {
          updated[props[key]] = cmd[key];
        }
      });

      var requestOptions = {
        _httpSignatureFromConfig: results.config,
        method: 'POST',
        json: updated
      };

      common.request(cmd, results.url, requestOptions,
        function(err, res, result) {
          if(err) {
            return callback(err);
          }
          callback(null, {
            res: res,
            result: result
          });
        });
    }],
    output: ['update', function(callback, results) {
      common.output(cmd, results.update.result, callback);
    }]
  }, function(err) {
    common.error(err);
    callback();
  });
}

function _vendors(cmd, budget, callback) {
  async.waterfall([
    function(callback) {
      common.config.read(cmd, callback);
    },
    function(cfg, callback) {
      // default id to key owner from config
      cmd.identity = cmd.identity || cfg.owner;

      if(!cmd.identity) {
        return callback(new Error('No id or key owner found.'));
      }

      var url = common.makeId(cmd.identity + '/budgets', budget);
      // FIXME: check cross authority id

      var requestOptions = {
        _httpSignatureFromConfig: cfg
      };

      if(cmd.addVendor) {
        requestOptions.method = 'POST';
        requestOptions.json = {
          '@context': payswarm.CONTEXT_URL,
          vendor: cmd.addVendor
        };
      }

      if(cmd.deleteVendor) {
        requestOptions.method = 'DELETE';
        requestOptions.qs = {
          vendor: cmd.deleteVendor
        };
      }

      common.request(cmd, url, requestOptions, callback);
    },
    function(res, result, callback) {
      common.output(cmd, result, callback);
    }
  ], function(err) {
    common.error(err);
    callback();
  });
}

module.exports = {
  init: init
};

if(require.main === module) {
  common.error('Run this tool with the payswarm application.');
}
