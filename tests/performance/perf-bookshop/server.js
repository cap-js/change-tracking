import cds from '@sap/cds';

const LOG = cds.log('perf-bookshop');

// Clean up data from previous test runs on server startup
cds.on('served', async () => {
	try {
		LOG.info('Cleaning up previous test data...');
		const srv = await cds.connect.to('AdminService');
		await srv.send('cleanUp');
		LOG.info('Cleanup complete');
	} catch (e) {
		LOG.warn('Cleanup failed:', e.message);
	}
});
