import { json, listClientCourses } from '../../_portal.js';

export async function onRequestGet({ env, data }) {
  const { results } = await listClientCourses(env.PORTAL_DB, data.clientEmail);
  const courses = new Map();
  for (const row of results) {
    if (!courses.has(row.course_id)) courses.set(row.course_id, { title: row.title, files: [] });
    if (row.material_id) courses.get(row.course_id).files.push({ id: row.material_id, name: row.filename, size: row.size });
  }
  return json({ courses: [...courses.values()] });
}
