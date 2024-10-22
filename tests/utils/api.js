class RequestSend {
    constructor(post) {
        this.post = post;
    }
    async apiAction(serviceName, entityName, id, path, action, isRootCreated = false) {
        if (!isRootCreated) {
            await this.post(`/odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=true)/${path}.draftEdit`, {
                PreserveChanges: true,
            });
        }
        if (Array.isArray(action)) {
            for (const act of action) {
                await act();
            }
        } else {
            await action();
        }
        await this.post(`/odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftPrepare`, {
            SideEffectsQualifier: "",
        });
        await this.post(`/odata/v4/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftActivate`, {});
    }
}

module.exports = {
    RequestSend,
};
