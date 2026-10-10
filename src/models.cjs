class ModelCatalog {
  constructor(connection) {
    this.connection = connection;
    this.models = [];
    this.defaults = { model: null, effort: null };
    this.refreshedAt = 0;
  }
  async refresh(cwd) {
    const models = [], seen = new Set();
    let cursor, pages = 0;
    const deadline = Date.now() + 30000;
    do {
      if (++pages > 20 || Date.now() >= deadline) throw new Error('Codex 모델 목록 조회 한도에 도달했습니다. 다시 조회해주세요.');
      const page = await this.connection.request('model/list', { limit: 50, includeHidden: false, ...(cursor ? { cursor } : {}) }, Math.max(1, deadline - Date.now()));
      if (!page || !Array.isArray(page.data) || page.data.length > 200 || (page.nextCursor != null && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 4096))) throw new Error('Codex 모델 목록 형식이 올바르지 않습니다.');
      for (const model of page.data) {
        if (!model || typeof model.model !== 'string' || !model.model || typeof model.displayName !== 'string' || !Array.isArray(model.supportedReasoningEfforts) || !model.supportedReasoningEfforts.length || model.supportedReasoningEfforts.some(e => !e || typeof e.reasoningEffort !== 'string') || (model.serviceTiers != null && !Array.isArray(model.serviceTiers))) throw new Error('Codex 모델 정보가 올바르지 않습니다.');
        if (!model.hidden && !models.some(m => m.model === model.model)) models.push({ model: model.model, name: model.displayName, description: model.description, isDefault: model.isDefault, defaultEffort: model.defaultReasoningEffort, efforts: model.supportedReasoningEfforts.map(e => ({ value: e.reasoningEffort, description: e.description })), serviceTiers: (model.serviceTiers ?? []).filter(t => t && typeof t.id === 'string' && t.id !== 'default').map(t => ({id:t.id,name:t.name || t.id,description:t.description || ''})) });
      }
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Codex 모델 목록의 페이지 응답이 반복됩니다.');
      if (cursor) seen.add(cursor);
      if (models.length > 200) throw new Error('Codex 모델 목록이 너무 큽니다.');
    } while (cursor);
    if (Date.now() >= deadline) throw new Error('Codex 모델 목록 조회 시간이 초과됐습니다.');
    const effective = await this.connection.request('config/read', { cwd, includeLayers: false }, Math.max(1, deadline - Date.now()));
    if (!effective?.config || typeof effective.config !== 'object' || (effective.config.model != null && typeof effective.config.model !== 'string') || (effective.config.model_reasoning_effort != null && typeof effective.config.model_reasoning_effort !== 'string')) throw new Error('Codex 기본 모델 설정이 올바르지 않습니다.');
    this.models = models;
    this.defaults = { model: effective.config.model ?? models.find(m => m.isDefault)?.model ?? null, effort: effective.config.model_reasoning_effort ?? null };
    this.refreshedAt = Date.now();
    return { models: this.models, defaults: this.defaults };
  }
  resolve(model, effort, serviceTier = 'default') {
    const effectiveModel = model || this.defaults.model;
    const entry = this.models.find(m => m.model === effectiveModel);
    if (!entry) throw new Error('선택한 모델이 현재 목록에 없습니다. 모델 목록을 새로고침하거나 다른 모델을 선택해주세요.');
    const effectiveEffort = effort || (!model && this.defaults.effort) || entry.defaultEffort;
    if (!entry.efforts.some(e => e.value === effectiveEffort)) throw new Error('이 모델에서 지원하지 않는 추론 단계입니다. 기본 추론 단계 또는 지원하는 값을 선택해주세요.');
    const tier = entry.serviceTiers?.find(t => t.id === serviceTier);
    if (serviceTier !== 'default' && !tier) throw new Error('선택한 모델에서 이 속도를 지원하지 않습니다. Standard 또는 지원하는 속도를 선택해주세요.');
    return { model: effectiveModel, effort: effectiveEffort, modelName: entry.name, serviceTier, serviceTierName: tier?.name ?? 'Standard' };
  }
}

module.exports = { ModelCatalog };
