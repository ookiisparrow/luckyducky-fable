import { getCollection } from 'astro:content'

/** 教程合集页 meta 与 RSS 频道说明单源——改一处两处出。 */
export const TUTORIALS_DESCRIPTION =
  '零基础钩织教程：从起针、辨认针目到收尾藏线，配合小棉鸭初学者钩织学习套装的分步图文讲解，新手也能跟着做。'

export async function sortedTutorials() {
  return (await getCollection('tutorials')).sort((a, b) => (a.data.datePublished < b.data.datePublished ? 1 : -1))
}
