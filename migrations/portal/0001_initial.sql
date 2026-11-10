CREATE TABLE courses (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE enrollments (
  email TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  PRIMARY KEY (email, course_id)
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  filename TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE INDEX materials_by_course ON materials(course_id);
