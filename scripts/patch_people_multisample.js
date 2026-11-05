const fs = require('fs');
let code = fs.readFileSync('backend/app/people.py', 'utf8');

// 1. Update enroll signature
code = code.replace(
  'def enroll(self, name: str, notes: str, image_bytes: bytes, person_id: str | None = None) -> dict[str, Any]:',
  'def enroll(self, name: str, notes: str, image_bytes: bytes, person_id: str | None = None, append_sample: bool = False) -> dict[str, Any]:'
);

// 2. Update insert / update logic in enroll
const oldEnrollDb = `        with self.engine.begin() as conn:
            # Check if updating an existing record by id or exact name
            existing = None
            if person_id:
                existing = conn.execute(select(people.c.id).where(people.c.id == person_id)).fetchone()
            else:
                existing = conn.execute(select(people.c.id).where(people.c.name == name)).fetchone()

            if existing:
                target_id = existing.id
                conn.execute(
                    update(people).where(people.c.id == target_id).values(
                        name=name,
                        notes=notes.strip()[:2000],
                        updated=now,
                        embedding=embedding_bytes
                    )
                )
            else:
                conn.execute(insert(people).values(
                    id=target_id,
                    name=name,
                    notes=notes.strip()[:2000],
                    created=now,
                    updated=now,
                    embedding=embedding_bytes
                ))`;

const newEnrollDb = `        with self.engine.begin() as conn:
            # Check if updating an existing record by id or exact name (unless appending a new angle sample)
            existing = None
            if not append_sample:
                if person_id:
                    existing = conn.execute(select(people.c.id).where(people.c.id == person_id)).fetchone()
                else:
                    existing = conn.execute(select(people.c.id).where(people.c.name == name)).fetchone()

            if existing and not append_sample:
                target_id = existing.id
                conn.execute(
                    update(people).where(people.c.id == target_id).values(
                        name=name,
                        notes=notes.strip()[:2000],
                        updated=now,
                        embedding=embedding_bytes
                    )
                )
            else:
                conn.execute(insert(people).values(
                    id=target_id,
                    name=name,
                    notes=notes.strip()[:2000],
                    created=now,
                    updated=now,
                    embedding=embedding_bytes
                ))`;

code = code.replace(oldEnrollDb.replace(/\r\n/g, '\n'), newEnrollDb);
if (!code.includes('if not append_sample:')) {
  code = code.replace(oldEnrollDb, newEnrollDb);
}

// 3. Update list_people with grouped sample counts
const oldList = `    def list_people(self) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(people.c.id, people.c.name, people.c.notes, people.c.created).order_by(people.c.created.desc())).fetchall()
            return [{'id': r.id, 'name': r.name, 'notes': r.notes, 'created': r.created} for r in rows]`;

const newList = `    def list_people(self) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(people.c.id, people.c.name, people.c.notes, people.c.created).order_by(people.c.created.desc())).fetchall()
            grouped: dict[str, dict[str, Any]] = {}
            for r in rows:
                key = r.name.strip().lower()
                if key not in grouped:
                    grouped[key] = {
                        'id': r.id,
                        'name': r.name,
                        'notes': r.notes,
                        'created': r.created,
                        'sample_count': 1,
                        'sample_ids': [r.id]
                    }
                else:
                    grouped[key]['sample_count'] += 1
                    grouped[key]['sample_ids'].append(r.id)
            return list(grouped.values())`;

code = code.replace(oldList.replace(/\r\n/g, '\n'), newList);
if (!code.includes('sample_count')) {
  code = code.replace(oldList, newList);
}

// 4. Update delete_person to clean all samples for that name
const oldDelete = `    def delete_person(self, person_id: str) -> bool:
        with self.engine.begin() as conn:
            res = conn.execute(delete(people).where(people.c.id == person_id))
            if res.rowcount > 0:
                self._invalidate_gallery()
                return True
            return False`;

const newDelete = `    def delete_person(self, person_id: str) -> bool:
        with self.engine.begin() as conn:
            row = conn.execute(select(people.c.name).where(people.c.id == person_id)).fetchone()
            if not row:
                return False
            res = conn.execute(delete(people).where(people.c.name == row.name))
            if res.rowcount > 0:
                self._invalidate_gallery()
                return True
            return False`;

code = code.replace(oldDelete.replace(/\r\n/g, '\n'), newDelete);
if (!code.includes('delete(people).where(people.c.name == row.name)')) {
  code = code.replace(oldDelete, newDelete);
}

// 5. Update router /enroll query parameter
code = code.replace(
  'person_id: str | None = Query(None),',
  'person_id: str | None = Query(None),\n        append_sample: bool = Query(False),'
);
code = code.replace(
  'return await run_in_threadpool(recognizer.enroll, name, notes, payload, person_id)',
  'return await run_in_threadpool(recognizer.enroll, name, notes, payload, person_id, append_sample)'
);

fs.writeFileSync('backend/app/people.py', code, 'utf8');
console.log('backend/app/people.py multi-sample patch successful!');
