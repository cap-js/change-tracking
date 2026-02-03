const cds = require('@sap/cds');

module.exports = cds.service.impl(async (srv) => {
	srv.before('CREATE', 'BookStores.drafts', async (req) => {
		const newBookStores = req.data;
		newBookStores.lifecycleStatus_code = 'IP';
	});

	const onActivateVolumns = async (req) => {
		const entity = req.entity;
		const entityID = 'dd1fdd7d-da2a-4600-940b-0baf2946c9bf';
		await UPDATE.entity(entity).where({ ID: entityID }).set({ ActivationStatus_code: 'VALID' });

		const booksEntity = 'AdminService.Books';
		const booksID = '676059d4-8851-47f1-b558-3bdc461bf7d5';
		await UPDATE.entity(booksEntity, { ID: booksID }).set({ title: 'Black Myth wukong' });
	};

	const onActivateOrderItemNote = async (req) => {
		await UPDATE.entity(req.entity)
			.where({ ID: req.params.at(-1).ID ?? req.params.at(-1) })
			.set({ ActivationStatus_code: 'VALID' });

		await UPDATE.entity('VariantTesting.Level2Sample', { ID: req.data.ID }).set({ title: 'Game Science' });
	};

	const onActivateLevel2Sample = async (req) => {
		const entity = req.entity;
		const entityID = '/level2one';
		await UPDATE.entity(entity).where({ ID: entityID }).set({ title: 'special title' });

		const rootSampleEntity = 'AdminService.RootSample';
		const rootSampleID = '/two';
		await UPDATE.entity(rootSampleEntity, { ID: rootSampleID }).set({ title: 'Black Myth Zhong Kui' });
	};

	srv.on('activate', 'AdminService.Volumes', onActivateVolumns);
	srv.on('activate', 'AdminService.OrderItemNote', onActivateOrderItemNote);
	srv.on('activate', 'AdminService.Level2Sample', onActivateLevel2Sample);
});
