import cds from '@sap/cds';

const AMOUNT_CHILDREN = 2000;

export default class AdminService extends cds.ApplicationService {
	init() {
		const { Chapters, Books } = cds.entities('sap.capire.bookshop');
		const { Chapters: srvChapters, Books: srvBooks } = this.entities;

		this.on('createChildren', async (req) => {
			const book = await SELECT.one.from(req.subject);
			const children = [];
			for (let i = 0; i < AMOUNT_CHILDREN; i++) {
				children.push({
					book_ID: book.ID,
					number: i,
					name: `Chapter ${i}`
				});
			}
			await INSERT.into(Chapters).entries(children);
		});

		this.on('updateChildren', async (req) => {
			const book = await SELECT.one.from(req.subject);
			await UPDATE.entity(Chapters)
				.where({ book_ID: book.ID })
				.set({
					number: Math.round(Math.random() * 10000)
				});
		});

		this.on('deleteChildren', async (req) => {
			const book = await SELECT.one.from(req.subject);
			await DELETE.from(req.target.isDraft ? srvChapters.drafts : Chapters).where({ book_ID: book.ID });
		});

		this.on('setupMockData', async () => {
			const ID = cds.utils.uuid();
			await INSERT.into(Books).entries({ ID, name: `Book ${Math.round(Math.random() * 100000)}` });
			await this.createChildren(srvBooks, { ID }, {});
			return { bookID: ID };
		});

		this.on('cleanUp', async () => {
			const { Changes } = cds.entities('sap.changelog');
			await DELETE.from(Changes).where('1 = 1');
			await DELETE.from(Books).where('1 = 1');
		});

		return super.init();
	}
}
