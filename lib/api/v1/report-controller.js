// Handles CRUD requests for reports.

var express = require('express');
var Report = require('../../../models/report');
var batch = require('../../../models/batch');
var ReportQuery = require('../../../models/query/report-query');
var _ = require('underscore');
var db = require('monk')(process.env.MONGOLAB_URI || "mongodb://localhost/aggie");
var moment = require('moment');


function dateFromISO8601(isostr) {
  var parts = isostr.match(/\d+/g);
  return new Date(parts[0], parts[1] -1, parts[2], parts[3], parts[4], parts[5]);
}

module.exports = function(app, user) {
  app = app || express();
  user = user || require('../authorization')(app);


  app.get('/api/v1/report/viz', user.can('view data'), function(req, res) {
    var startTime = dateFromISO8601(req.query.startTime);
    var endTime = dateFromISO8601(req.query.endTime);
    db.get('reports').find({$and: [{authoredAt: {$gte:startTime}} , { authoredAt:{$lte:endTime}}]},{}, function(err, data) {
      if(err) res.send(err.status, err.message);
      else {res.send(200, data);}
    });
  });

  // Get a list of all Reports
  app.get('/api/v1/report', user.can('view data'), function(req, res) {
    var page = req.query.page;
    // Parse query string
    var queryData = parseQueryData(req.query);
    if (queryData) {
      var query = new ReportQuery(queryData);
      // Query for reports using fti
      Report.queryReports(query, page, function(err, reports) {
        if (err) res.send(err.status, err.message);
        else res.send(200, reports);
      });
    } else {
      // Return all reports using pagination
      Report.findSortedPage({}, page, function(err, reports) {
        if (err) res.send(err.status, err.message);
        else res.send(200, reports);
      });
    }
  });

  // Load batch
  app.get('/api/v1/report/batch', user.can('view data'), function(req, res) {
    batch.load(req.session.user._id, function(err, reports) {
      if (err) res.send(err.status, err.message);
      else res.send(200, {results: reports, total: reports.length});
    });
  });

  // Checkout new batch
  app.patch('/api/v1/report/batch', user.can('edit reports'), function(req, res) {
    batch.checkout(req.session.user._id, function(err, reports) {
      if (err) res.send(err.status, err.message);
      else res.send(200, {results: reports, total: reports.length});
    });
  });

  // Cancel batch
  app.put('/api/v1/report/batch', user.can('edit reports'), function(req, res) {
    batch.cancel(req.session.user._id, function(err) {
      if (err) res.send(err.status, err.message);
      else res.send(200);
    });
  });

  // Get Report by id
  app.get('/api/v1/report/:_id', function(req, res) {
    Report.findById(req.params._id, function(err, report) {
      if (err) res.send(err.status, err.message);
      else if (!report) res.send(404);
      else res.send(200, report);
    });
  });

  // Update Report data
  app.put('/api/v1/report/:_id', user.can('edit reports'), function(req, res, next) {
    // Find report to update
    Report.findById(req.params._id, function(err, report) {
      if (err) return res.send(err.status, err.message);
      if (!report) return res.send(404);
      // Update the actual value
      _.each(_.pick(req.body, ['flagged', '_incident', 'read']), function(val, key) {
        report[key] = val;
      });
      // Save report
      report.save(function(err, numberAffected) {
        if (err) res.send(err.status, err.message);
        else if (!numberAffected) res.send(404);
        else res.send(200);
      });
    });
  });

  // Delete all reports
  app.delete('/api/v1/report/_all', user.can('delete data'), function(req, res) {
    Report.remove(function(err) {
      if (err) res.send(err.status, err.message);
      else res.send(200);
    });
  });

  // Mark selected reports as read
  app.patch('/api/v1/report/_read', user.can('edit reports'), function(req, res) {
    if (!req.body.ids || !req.body.ids.length) return res.send(200);

    Report.find({_id: {$in: req.body.ids}}, function(err, reports) {
      if (err) return res.send(err.status, err.message);
      if (reports.length === 0) return res.send(200);
      var remaining = reports.length;
      reports.forEach(function(report) {
        // Mark each report as read only to catch it in model
        report.toggleRead(req.body.read);
        report.save(function(err) {
          if (err) return res.send(err.status, err.message);
          if (--remaining === 0) return res.send(200);
        });
      });
    });
  });

  // Flag selected reports
  app.patch('/api/v1/report/_flag', user.can('edit reports'), function(req, res) {
    if (!req.body.ids || !req.body.ids.length) return res.send(200);

    Report.find({_id: {$in: req.body.ids}}, function(err, reports) {
      if (err) return res.send(err.status, err.message);
      if (reports.length === 0) return res.send(200);
      var remaining = reports.length;
      reports.forEach(function(report) {
        // Mark each report as flagged to catch it in model
        report.toggleFlagged(req.body.flagged);
        report.save(function(err) {
          if (err) return res.send(err.status, err.message);
          if (--remaining === 0) return res.send(200);
        });
      });
    });
  });

  return app;
};

// Determine the search keywords
function parseQueryData(queryString) {
  if (!queryString) return;

  // Data passed through URL parameters
  return _.pick(queryString, ['keywords', 'status', 'after', 'before', 'media', 'sourceId', 'incidentId', 'author']);
}
