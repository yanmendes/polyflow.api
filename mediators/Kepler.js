let prov = require('../models/Prov'),
  provone = require('../models/Provone'),
  pg = require('../infra/PsqlInterface'),
  _ = require('lodash');

//TODO: REFACTOR CODE USING PROV-PROVONE




module.exports = {
  [provone.Classes.PORT]: {
    entity1: { name: 'port', alias: 'port', columns: [] },
    entity2: { name: 'entity', alias: 'entity', columns: [] },
    type: 'inner',
    params: ['port.id', 'entity.id'],
    columns: {
      port_id: 'entity.id',
      label: 'entity.name',
      port_type: `CASE WHEN port.direction = 1 THEN 'out' WHEN port.direction = 0 THEN 'in' END`
    }
  },
  [prov.Classes.ENTITY]: {
    entity1: {
      entity1: { name: 'parameter', alias: 'p' },
      entity2: { name: 'entity', alias: 'e' },
      type: 'inner',
      params: ['p.id', 'e.id'],
      columns: {
        entity_id: 'p.id',
        label: 'e.name',
        type: 'p.type',
        value: 'p.value',
        entity_type: `'provone_Data'`
      }
    },
    entity2: {
      entity1: { name: 'data', alias: 'd' },
      entity2: { name: 'associated_data', alias: 'ad' },
      type: 'left',
      params: ['d.md5', 'ad.data_id'],
      columns: {
        entity_id: 'NULL',
        label: 'ad.name',
        type: `'md5'`,
        value: 'd.md5',
        entity_type: `'provone_Data'`
      }
    },
    type: 'union'
  },
}




var Kepler = function () {

};

Kepler.prototype.execute = (workflowIdentifier) => {
  return Kepler.prototype.Port(workflowIdentifier).then(() => {
    return Kepler.prototype.Entity(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.Program(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.Execution(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.Usage(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.Generation(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.PopulateExecutionRelations(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.PopulatePortRelations(workflowIdentifier);
  }).then(() => {
    return Kepler.prototype.PopulateEntityRelations(workflowIdentifier);
  });
};

Kepler.prototype.Program = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query('select a.id as program_id, COALESCE(w.name, e.name) as label, case when w.id is not null then true else false end as "is_provone_Workflow", case when w.id is not null then NULL else e.wf_id end as "provone_hasSubProgram"\n' +
      "from actor a, entity e\n" +
      "left join workflow w on w.id = e.id\n" +
      "where a.id = e.id", (err, res) => {
        if (err || res === undefined)
          return reject(err);
        else
          return resolve(insert(provone.Classes.PROGRAM, _.map(res.rows, (o) => { return _.extend({}, o, { workflow_identifier: workflowIdentifier }) })));
      });
  });
};


//TODO: CHANGE THIS RANDOM GENERATORS
Kepler.prototype.Execution = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query(`select id as execution_id, actor_id as "prov_hadPlan", to_char(start_time, 'dd-mon-yyyy hh24:mi:ss') as "prov_startedAtTime", to_char(end_time, 'dd-mon-yyyy hh24:mi:ss') as "prov_endedAtTime" from actor_fire\n` +
      'UNION ALL\n' +
      `select FLOOR(random()*(10000)+1000) AS execution_id, wf_id as "prov_hadPlan", to_char(start_time, 'dd-mon-yyyy hh24:mi:ss') as "prov_startedAtTime", to_char(end_time, 'dd-mon-yyyy hh24:mi:ss') as "prov_endedAtTime" from workflow_exec`, (err, res) => {
        if (err || res === undefined)
          return reject(err);

        res.rows = _.map(res.rows, (o) => { return _.extend({}, o, { workflow_identifier: workflowIdentifier }) });

        let associations = _.map(res.rows, _.partialRight(_.pick, ['prov_hadPlan', 'workflow_identifier']));
        let executions = _.map(res.rows, _.partialRight(_.pick, ['execution_id', 'prov_startedAtTime', 'prov_endedAtTime', 'workflow_identifier']));

        return resolve(insert(provone.Classes.EXECUTION, executions).then(() => {
          return insert(prov.Classes.ASSOCIATION, associations);
        }).then(() => {
          return db.query(`SELECT association_id, prov_hadPlan, workflow_identifier FROM ${prov.Classes.ASSOCIATION} WHERE prov_hadPlan IN (?) AND workflow_identifier = ?`, {
            type: db.QueryTypes.SELECT,
            replacements: [associations.map(a => a.prov_hadPlan), workflowIdentifier]
          });
        }).then((results) => {
          let qualifiedAssociations = _.map(_.map(results, (o) => {
            return _.extend({}, o, { execution_id: _.find(res.rows, { 'prov_hadPlan': o.prov_hadplan }).execution_id });
          }), _.partialRight(_.pick, ['association_id', 'execution_id', 'workflow_identifier']));
          return insert(prov.Relationships.QUALIFIEDASSOCIATION, qualifiedAssociations)
        }));
      });
  });
};

Kepler.prototype.Usage = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query('select data as "value", port_id as "provone_hadInPort", fire_id as execution_id from port_event where write_event_id = -1', (err, res) => {
      if (err || res === undefined)
        return reject(err);

      res.rows = _.map(res.rows, (o) => { return _.extend({}, o, { workflow_identifier: workflowIdentifier }) });
      let search = 'e.value LIKE \'' + _.join(res.rows.map(a => a.value.replace('\'', '')), '\' OR e.value LIKE \'');

      resolve(db.query(`SELECT entity_id, value FROM ${prov.Classes.ENTITY} e WHERE ${search}\' AND workflow_identifier = ?`, {
        type: db.QueryTypes.SELECT,
        replacements: [workflowIdentifier]
      }).then((results) => {
        let usage = _.map(_.map(res.rows, (o) => {
          return _.extend({}, o, { provone_hadEntity: _.find(results, (a) => { return a.value.replace('\'', '') === o.value.replace('\'', '') }).entity_id });
        }), _.partialRight(_.pick, ['provone_hadInPort', 'provone_hadEntity', 'workflow_identifier']));

        return insert(prov.Classes.USAGE, usage);
      }).then(() => {
        return db.query(`SELECT usage_id, provone_hadinport, workflow_identifier FROM ${prov.Classes.USAGE} e WHERE workflow_identifier = ?`, {
          type: db.QueryTypes.SELECT,
          replacements: [workflowIdentifier]
        });
      }).then((results) => {
        let qualifiedUsage = _.map(_.map(results, (o) => {
          return _.extend({}, o, { execution_id: _.find(res.rows, { 'provone_hadInPort': o.provone_hadinport }).execution_id });
        }), _.partialRight(_.pick, ['usage_id', 'execution_id', 'workflow_identifier']));

        return insert(prov.Relationships.QUALIFIEDUSAGE, qualifiedUsage);
      }));
    });
  });
};

Kepler.prototype.Generation = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query('select data as "value", port_id as "provone_hadOutPort", fire_id as execution_id from port_event where write_event_id != -1', (err, res) => {
      if (err || res === undefined)
        return reject(err);

      res.rows = _.map(res.rows, (o) => { return _.extend({}, o, { workflow_identifier: workflowIdentifier }) });
      let search = 'e.value LIKE \'' + _.join(res.rows.map(a => a.value === null ? '' : a.value.replace('\'', '')), '\' OR e.value LIKE \'');

      resolve(db.query(`SELECT entity_id, value FROM ${prov.Classes.ENTITY} e WHERE ${search}\' AND workflow_identifier = ?`, {
        type: db.QueryTypes.SELECT,
        replacements: [workflowIdentifier]
      }).then((results) => {
        let generation = _.map(_.map(res.rows, (o) => {
          let hadEntity = _.find(results, (a) => { return a.value === null || o.value === null ? false : a.value.replace('\'', '') === o.value.replace('\'', '') }) ?
            _.find(results, (a) => { return a.value === null || o.value === null ? false : a.value.replace('\'', '') === o.value.replace('\'', '') }).entity_id : null;
          return _.extend({}, o, { provone_hadEntity: hadEntity });
        }), _.partialRight(_.pick, ['provone_hadOutPort', 'provone_hadEntity', 'workflow_identifier']));

        return insert(prov.Classes.GENERATION, generation);
      }).then(() => {
        return db.query(`SELECT generation_id, provone_hadoutport, workflow_identifier FROM ${prov.Classes.GENERATION} e WHERE workflow_identifier = ?`, {
          type: db.QueryTypes.SELECT,
          replacements: [workflowIdentifier]
        });
      }).then((results) => {
        let qualifiedGeneration = _.map(_.map(results, (o) => {
          return _.extend({}, o, { execution_id: _.find(res.rows, { 'provone_hadOutPort': o.provone_hadoutport }).execution_id });
        }), _.partialRight(_.pick, ['generation_id', 'execution_id', 'workflow_identifier']));

        return insert(prov.Relationships.QUALIFIEDGENERATION, qualifiedGeneration);
      }));
    });
  });
};

Kepler.prototype.PopulateExecutionRelations = (workflowIdentifier) => {
  let users = null;
  return new Promise((resolve, reject) => {
    return pg.query("select user as label, wf_id AS program_id from workflow_exec", (err, res) => {
      if (err || res === undefined)
        return reject(err);

      res.rows = _.map(res.rows, (o) => {
        return _.extend({}, o, { workflow_identifier: workflowIdentifier })
      });

      return resolve(insert(provone.Classes.USER, _.map(res.rows, _.partialRight(_.pick, ['label', 'workflow_identifier'])
      )).then(() => {
        return db.query(`SELECT * FROM ${provone.Classes.USER} u WHERE workflow_identifier = ?`, { type: db.QueryTypes.SELECT, replacements: [workflowIdentifier] });
      }).then((results) => {
        users = _.map(results, (o) => {
          return _.extend({}, o, { program_id: _.find(res.rows, { 'label': o.label }).program_id })
        });

        return db.query(`SELECT e.execution_id, e2.execution_id AS provone_waspartof, p.program_id, p.provone_hassubprogram AS wf_id ` +
          `FROM ${provone.Classes.EXECUTION} e ` +
          `INNER JOIN ${prov.Relationships.QUALIFIEDASSOCIATION} qa ON qa.execution_id = e.execution_id AND qa.workflow_identifier = e.workflow_identifier ` +
          `INNER JOIN ${prov.Classes.ASSOCIATION} a ON qa.association_id = a.association_id AND qa.workflow_identifier = a.workflow_identifier ` +
          `INNER JOIN ${provone.Classes.PROGRAM} p ON p.program_id = a.prov_hadplan AND p.workflow_identifier = a.workflow_identifier ` +
          `LEFT JOIN ${prov.Classes.ASSOCIATION} a2 ON p.provone_hassubprogram = a.prov_hadplan AND p.workflow_identifier = a2.workflow_identifier ` +
          `LEFT JOIN ${prov.Relationships.QUALIFIEDASSOCIATION} qa2 ON qa2.association_id = a2.association_id AND qa2.workflow_identifier = a2.workflow_identifier ` +
          `LEFT JOIN ${provone.Classes.EXECUTION} e2 ON qa2.execution_id = e2.execution_id AND qa2.workflow_identifier = e2.workflow_identifier ` +
          `WHERE e.workflow_identifier = :wid AND (p.program_id IN (:programs) OR p.provone_hassubprogram IN (:programs))`, {
            type: db.QueryTypes.SELECT,
            replacements: { wid: workflowIdentifier, programs: res.rows.map(a => a.program_id) }
          });
      }).then((results) => {
        let promises = [];

        _.each(results, (o) => {
          promises.push(db.query(`UPDATE ${provone.Classes.EXECUTION} SET prov_wasassociatedwith = :uid, provone_waspartof = :partof WHERE execution_id = :eid AND workflow_identifier = :wid`, {
            replacements: {
              uid: (_.find(users, (u) => { return u.program_id === o.program_id || u.program_id === o.wf_id })) ?
                (_.find(users, (u) => { return u.program_id === o.program_id || u.program_id === o.wf_id })).user_id : null,
              partof: o.provone_waspartof,
              eid: o.execution_id,
              wid: workflowIdentifier
            }
          }));
        });

        return Promise.all(promises);
      }));
    });
  });
};

Kepler.prototype.PopulatePortRelations = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query('select distinct case when write_event_id = -1 then 0 else 1 end as write, pe.port_id, af.actor_id from port_event pe\n' +
      'inner join actor_fire af on pe.fire_id = af.id', (err, res) => {
        if (err || res === undefined)
          return reject(err);

        let promises = [];

        _.each(res.rows, (o) => {
          var replacements = {
            pid: o.port_id,
            eid: o.actor_id,
            portType: (o.write) ? 'provone_hasOutPort' : 'provone_hasInPort',
            wid: workflowIdentifier
          };

          promises.push(db.query(`UPDATE ${provone.Classes.PORT} SET ${replacements.portType} = :eid WHERE port_id = :pid AND workflow_identifier = :wid`, { replacements: replacements }));
        });

        return resolve(Promise.all(promises));
      });
  });
};

Kepler.prototype.PopulateEntityRelations = (workflowIdentifier) => {
  return new Promise((resolve, reject) => {
    return pg.query('select distinct case when write_event_id = -1 then 0 else 1 end as write, coalesce(data, file_id, data_id) as data, fire_id as execution_id from port_event', (err, res) => {
      if (err || res === undefined)
        return reject(err);

      let promises = [];

      _.each(res.rows, (o) => {
        var replacements = {
          data: o.data,
          exeid: o.execution_id,
          rtype: (o.write) ? 'prov_wasgeneratedby' : 'prov_used',
          wid: workflowIdentifier
        };

        promises.push(db.query(`UPDATE ${prov.Classes.ENTITY} SET ${replacements.rtype} = :exeid WHERE value = :data AND workflow_identifier = :wid`, { replacements: replacements }));
      });

      return resolve(Promise.all(promises));
    });
  });
};
