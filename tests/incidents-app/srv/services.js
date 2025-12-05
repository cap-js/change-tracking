const cds = require('@sap/cds');
const { SELECT } = cds.ql;

class ProcessorService extends cds.ApplicationService {
	/** Registering custom event handlers */
	init() {
		const { Incidents, MultiKeyScenario } = this.entities;

		this.before('UPDATE', Incidents, (req) => this.onUpdate(req));
		this.before(['CREATE', 'UPDATE'], Incidents, (req) => this.changeUrgencyDueToSubject(req.data));
		this.before('SAVE', Incidents, (req) => {
			req.data.time = '01:02:03';
			req.data.date = '2025-10-18';
			req.data.timestamp = new Date(req.data.timestamp);
			req.data.timestamp.setDate(new Date(req.data.timestamp).getDate() + 1);
			req.data.timestamp = req.data.timestamp.toISOString();
			req.data.datetime = new Date(req.data.datetime);
			req.data.datetime.setDate(new Date(req.data.datetime).getDate() + 1);
			req.data.datetime = req.data.datetime.toISOString();
		});
		return super.init();
	}

	changeUrgencyDueToSubject(data) {
		if (data) {
			const incidents = Array.isArray(data) ? data : [data];
			incidents.forEach((incident) => {
				if (incident.title?.toLowerCase().includes('urgent')) {
					incident.urgency = { code: 'H', descr: 'High' };
				}
			});
		}
	}

	/** Custom Validation */
	async onUpdate(req) {
		const { status_code } = await SELECT.one(req.subject, (i) => i.status_code).where({ ID: req.data.ID });
		if (status_code === 'C') {
			return req.reject(`Can't modify a closed incident`);
		}
	}
}

module.exports = { ProcessorService };
