const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Use instance to ensure that tempFolders list is not global
 * but local to each test
 *
 * const TempUtil = require('./utils/tempUtil');
 * const tempUtil = new TempUtil(__filename);
 *
 * afterAll(async () => {
 *      await tempUtil.cleanUp();
 * });
 *
 * Inside test:
 * async () => {
 *      const tempFolder = await tempUtil.mkTempFolder();
 */
module.exports = class TempUtil {
	static get DEFAULT_TEMP_DIR() {
		return path.join(__dirname, '_out');
	}
	static get OS_TEMP_DIR() {
		return os.tmpdir();
	}

	constructor(fileName) {
		this.fileName = `${path.parse(path.basename(fileName)).name.replace('.', '-')}-`;
		this.tempFolders = new Set();
	}

	async mkTempFolder(tempDir = TempUtil.DEFAULT_TEMP_DIR) {
		if (!fs.existsSync(tempDir)) {
			await fs.promises.mkdir(tempDir, { recursive: true });
		}
		const tempFolder = await fs.promises.mkdtemp(path.join(tempDir, this.fileName));
		this.tempFolders.add(tempFolder);
		return tempFolder;
	}

	async cleanUp() {
		for (let tempFolder of this.tempFolders) {
			await fs.promises.rm(tempFolder, { force: true, recursive: true });
		}
		this.tempFolders.clear();
	}

	async mkTempProject(src, tempDir) {
		const tmp = await this.mkTempFolder(tempDir);
		const dest = path.join(tmp, path.basename(src));
		await fs.promises.cp(src, dest, { recursive: true });
		return await fs.promises.realpath(dest);
	}
};
