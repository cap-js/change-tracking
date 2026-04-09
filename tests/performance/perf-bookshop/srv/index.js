import cds from '@sap/cds';

const LOG = cds.log('perf-bookshop');

// Clean up data from previous test runs on server startup
cds.on('served', async () => {
	try {
		LOG.info('Cleaning up previous test data...');
		const { Changes } = cds.entities('sap.changelog');
		const { Books } = cds.entities('sap.capire.bookshop');
		await DELETE.from(Changes).where('1 = 1');
		await DELETE.from(Books).where('1 = 1');
		LOG.info('Cleanup complete');
	} catch (e) {
		LOG.warn('Cleanup failed:', e.message);
	}
});
