/**
 * Centralized PT-BR string dictionary.
 * All user-facing static text is defined here.
 */

const strings = {
  // Header & Navigation
  'header.title': 'Repos Internos',
  'nav.projects': 'Projetos',
  'nav.templates': 'Templates',
  'nav.upload': 'Upload',

  // Landing Page
  'landing.heading': 'Repositório Interno de Projetos',
  'landing.description': 'Explore projetos compartilhados pela equipe ou descubra templates prontos para iniciar novos desenvolvimentos.',
  'landing.projects.title': 'Projetos',
  'landing.projects.description': 'Navegue e pesquise projetos compartilhados pela equipe.',
  'landing.templates.title': 'Templates',
  'landing.templates.description': 'Descubra templates prontos para acelerar o desenvolvimento.',

  // Search (Projects)
  'search.heading': 'Pesquisar Projetos',
  'search.placeholder': 'Pesquisar por nome, descrição ou tags…',
  'search.loading': 'Carregando projetos…',
  'search.error': 'Não foi possível carregar os projetos',
  'search.retry': 'Tentar novamente',
  'search.noResults': 'Nenhum resultado encontrado',

  // Templates Page
  'templates.heading': 'Templates de Projeto',
  'templates.placeholder': 'Pesquisar templates por nome, descrição ou tags…',
  'templates.loading': 'Carregando templates…',
  'templates.empty': 'Nenhum template disponível ainda',

  // Project Detail
  'projectDetail.back': '← Voltar para projetos',
  'projectDetail.unavailable': 'Detalhes do projeto não disponíveis',
  'projectDetail.download': 'Baixar artifact.zip',
  'projectDetail.downloadDisabled': 'Baixar artifact.zip',
  'projectDetail.artifactUnavailable': 'Artefato não disponível para download',
  'projectDetail.docUnavailable': 'Documentação não disponível',
  'projectDetail.edit': 'Editar',
  'projectDetail.delete': 'Excluir',
  'projectDetail.repository': 'Repositório: ',
  'projectDetail.noProject': 'Nenhum projeto especificado',

  // Template Detail
  'templateDetail.back': '← Voltar para templates',
  'templateDetail.unavailable': 'Detalhes do template não disponíveis',
  'templateDetail.download': 'Baixar Template',
  'templateDetail.noTemplate': 'Nenhum template especificado',
  'templateDetail.docUnavailable': 'Documentação do template não disponível',
  'templateDetail.language': 'Linguagem',

  // Upload Form
  'upload.heading': 'Upload de Projeto',
  'upload.nameLabel': 'Nome do Projeto',
  'upload.namePlaceholder': 'meu-nome-de-projeto',
  'upload.repoLabel': 'URL do Repositório (opcional)',
  'upload.repoPlaceholder': 'https://github.com/org/repo',
  'upload.tagsLabel': 'Tags',
  'upload.readmeLabel': 'Conteúdo do Readme',
  'upload.readmePlaceholder': '# Meu Projeto\n\nDescreva seu projeto aqui...',
  'upload.submit': 'Enviar Projeto',
  'upload.submitting': 'Enviando...',
  'upload.uploadingFiles': 'Enviando arquivos... {completed}/{total}',
  'upload.zipping': 'Compactando arquivos...',
  'upload.initiating': 'Iniciando upload...',
  'upload.processing': 'Processando...',
  'upload.suggestingTags': 'Sugerindo tags...',
  'upload.tooLarge': 'Projeto muito grande para upload (excede limite de 500 MB).',
  'upload.noFilesAfterFilter': 'Nenhum arquivo restou após filtrar artefatos e padrões ignorados.',
  'upload.tagsWarning': 'Sugestões de tags existentes indisponíveis',

  // Edit Form
  'edit.heading': 'Editar Projeto',
  'edit.loading': 'Carregando dados do projeto...',
  'edit.loadError': 'Não foi possível carregar os dados do projeto',
  'edit.nameLabel': 'Nome do Projeto',
  'edit.repoLabel': 'URL do Repositório (opcional)',
  'edit.readmeLabel': 'Conteúdo do Readme',
  'edit.filesLabel': 'Substituir Artefato (opcional — selecione pasta)',
  'edit.submit': 'Salvar Alterações',
  'edit.saving': 'Salvando...',
  'edit.cancel': 'Cancelar',
  'edit.successWithArtifact': 'Projeto atualizado com sucesso (artefato substituído)!',
  'edit.success': 'Projeto atualizado com sucesso!',
  'edit.updatingMetadata': 'Atualizando metadados...',
  'edit.initiatingReplace': 'Iniciando substituição do artefato...',
  'edit.architectureLabel': 'Diagrama de Arquitetura (opcional)',
  'edit.architectureCurrent': 'Atual: {filename}',
  'edit.architectureRemove': 'Remover diagrama de arquitetura',
  'edit.architectureUploading': 'Enviando diagrama de arquitetura...',
  'edit.architectureUploadFailed': 'Falha ao enviar diagrama de arquitetura. Tente novamente.',

  // Delete Dialog
  'delete.title': 'Excluir Projeto',
  'delete.warning': 'Esta ação não pode ser desfeita. Isso excluirá permanentemente o projeto e todos os arquivos associados.',
  'delete.prompt': 'Digite <strong>{name}</strong> para confirmar.',
  'delete.inputPlaceholder': 'Digite o nome do projeto para confirmar',
  'delete.confirm': 'Excluir',
  'delete.cancel': 'Cancelar',
  'delete.deleting': 'Excluindo projeto…',
  'delete.success': 'Projeto "{name}" foi excluído.',

  // Architecture Image
  'upload.architectureLabel': 'Diagrama de Arquitetura (opcional)',
  'upload.architectureAccept': 'Formatos aceitos: PNG e SVG (máx. 5 MB)',
  'validation.architectureExtension': 'Formatos aceitos: PNG e SVG',
  'validation.architectureSize': 'Tamanho máximo: 5 MB',

  // Validation
  'validation.nameRequired': 'Nome do projeto é obrigatório',
  'validation.nameTooLong': 'Nome do projeto deve ter no máximo {max} caracteres',
  'validation.nameInvalid': 'Nome do projeto pode conter apenas caracteres alfanuméricos, hifens e underscores',
  'validation.readmeTooLong': 'Readme deve ter no máximo {max} caracteres',
  'validation.filesRequired': 'Pelo menos um arquivo deve ser selecionado',
  'validation.folderEmpty': 'Pasta selecionada não contém arquivos',
  'validation.repoTooLong': 'URL do repositório deve ter no máximo 2048 caracteres',
  'validation.repoInvalidProtocol': 'URL do repositório deve usar HTTPS ou HTTP',
  'validation.repoInvalidUrl': 'Por favor, insira uma URL válida',

  // Drop Zone
  'dropZone.text': 'Arraste uma pasta ou arquivo .zip aqui, ou clique para selecionar',
  'dropZone.summary': '{count} arquivo(s) selecionado(s)',
  'dropZone.summaryZip': '1 arquivo zip selecionado: {name}',
  'dropZone.summaryFolder': '{count} arquivo(s) selecionado(s) da pasta',

  // Readme Preview
  'readmePreview.write': 'Escrever',
  'readmePreview.preview': 'Pré-visualizar',
  'readmePreview.autofill': 'Preenchido automaticamente de {filename}',
  'readmePreview.truncated': 'Conteúdo foi truncado para {max} caracteres (máximo permitido).',

  // Card Grid
  'cardGrid.noResults': 'Nenhum resultado encontrado',

  // Paginator
  'paginator.previous': 'Anterior',
  'paginator.next': 'Próximo',

  // Theme Toggle
  'theme.switchToDark': 'Mudar para tema escuro',
  'theme.switchToLight': 'Mudar para tema claro',
} as const;

/** The complete dictionary type — flat keys mapping to PT-BR strings. */
export type I18nKey = keyof typeof strings;

/**
 * Look up a localized string by key.
 * Returns the PT-BR string if the key exists, or the key itself if missing.
 */
export function t(key: string): string;

/**
 * Look up a localized string with interpolation.
 * Replaces `{placeholder}` tokens in the string with provided values.
 * Missing interpolation params leave `{placeholder}` unchanged.
 */
export function t(key: string, params: Record<string, string | number>): string;

export function t(key: string, params?: Record<string, string | number>): string {
  const value = (strings as Record<string, string>)[key];
  if (value === undefined) {
    return key;
  }
  if (!params) {
    return value;
  }
  return value.replace(/\{(\w+)\}/g, (match, placeholder: string) => {
    const replacement = params[placeholder];
    return replacement !== undefined ? String(replacement) : match;
  });
}
