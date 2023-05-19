class RequestSend {
    constructor(post) {
        this.post = post;
    }
    async apiAction(serviceName, entityName, id, path, action, isRootCreated = false) {
        if (!isRootCreated) {
            await this.post(`/${serviceName}/${entityName}(ID=${id},IsActiveEntity=true)/${path}.draftEdit`, {
                PreserveChanges: true,
            });
        }
        await action();
        await this.post(`/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftPrepare`, {
            SideEffectsQualifier: "",
        });
        await this.post(`/${serviceName}/${entityName}(ID=${id},IsActiveEntity=false)/${path}.draftActivate`, {});
    }
}

module.exports = {
    RequestSend,
};
