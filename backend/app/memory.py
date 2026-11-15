"""Explicit, transactionally stored image memories; no inference or cloud transfer on save."""
from io import BytesIO
import hashlib
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import delete, func, insert, select, update
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from .database import memories, people
from .reading import decode_image, MAX_IMAGE_BYTES
from .records import NoteInput

SUMMARY = [column for column in memories.c if column.name != 'image']
CAPTURE = (memories.c.source == 'camera') & memories.c.title.startswith('Unidentified') & memories.c.text.startswith('Auto-saved cropped face for ')


class CaptureLink(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)
    person_id: str | None = Field(max_length=100)


class ImageMemories:
    def __init__(self, records):
        self.records = records

    def save(self, payload, note, original_text, source):
        picture = decode_image(payload)
        picture.thumbnail((1600,1600))
        output = BytesIO(); picture.save(output, format='JPEG', quality=88)
        image = output.getvalue()
        now = self.records.now()
        item = dict(id=str(uuid.uuid4()), title=note.title, text=note.text, ocr_text=original_text,
                    source=source, created=now, updated=now, width=picture.width, height=picture.height,
                    sha256=hashlib.sha256(image).hexdigest(),
                    capture_person_id=None, capture_auto_excluded=False)
        with self.records.connect(write=True, resource='memories') as db:
            if db.scalar(select(func.count()).select_from(memories)) >= 100:
                raise HTTPException(409, 'Remove an image memory before adding more (100 maximum)')
            db.execute(insert(memories).values(**item, image=image))
        return item

    def find(self, query):
        statement = select(*SUMMARY).order_by(memories.c.created.desc(), memories.c.id).limit(100)
        if query:
            statement = statement.where(func.lower(memories.c.title + '\n' + memories.c.text).contains(query.lower(), autoescape=True))
        with self.records.connect() as db:
            return [dict(row) for row in db.execute(statement).mappings()]

    def image(self, identity):
        with self.records.connect() as db:
            image = db.scalar(select(memories.c.image).where(memories.c.id == identity))
        if image is None:
            raise HTTPException(404, 'Image memory not found')
        return image

    def edit(self, identity, note):
        with self.records.connect(write=True) as db:
            result = db.execute(update(memories).where(memories.c.id == identity).values(
                title=note.title, text=note.text, updated=self.records.now()))
            if not result.rowcount:
                raise HTTPException(404, 'Image memory not found')
            return dict(db.execute(select(*SUMMARY).where(memories.c.id == identity)).mappings().one())

    def delete(self, identity):
        # Asset and metadata are the same row, so deletion cannot leave an orphaned image file.
        with self.records.connect(write=True) as db:
            db.execute(delete(memories).where(memories.c.id == identity))

    def expire_captures(self, cutoff):
        with self.records.connect(write=True, resource='memories') as db:
            db.execute(delete(memories).where(CAPTURE, memories.c.created < cutoff,
                                             memories.c.capture_person_id.is_(None)))

    def group_captures(self, recognizer, auto_assign=False):
        with self.records.connect() as db:
            captures = db.execute(select(memories.c.id, memories.c.image).where(
                CAPTURE, memories.c.capture_person_id.is_(None)
            ).order_by(memories.c.created.desc(), memories.c.id).limit(100)).all()
        groups = recognizer.group_captures(captures)
        assigned = {}
        if auto_assign:
            with self.records.connect(write=True, resource='memories') as db:
                for group in groups:
                    if not group['auto_ids']:
                        continue
                    target = select(people.c.id).where(
                        people.c.id == group['person_id'], people.c.consent_status == 'granted',
                        people.c.enrollment_state != 'revoked', people.c.permission != 'disabled'
                    ).exists()
                    moved = db.execute(update(memories).where(
                        CAPTURE, memories.c.id.in_(group['auto_ids']), target,
                        memories.c.capture_person_id.is_(None), memories.c.capture_auto_excluded.is_(False)
                    ).values(capture_person_id=group['person_id'], updated=self.records.now())
                        .returning(memories.c.id)).scalars()
                    assigned.update((identity, group['person_id']) for identity in moved)
        return {'groups': groups, 'assigned': assigned}

    def link_captures(self, link):
        ids = set(link.ids)
        with self.records.connect(write=True, resource='memories') as db:
            if link.person_id is not None and not db.scalar(select(people.c.id).where(
                people.c.id == link.person_id, people.c.consent_status == 'granted',
                people.c.enrollment_state != 'revoked', people.c.permission != 'disabled'
            )):
                raise HTTPException(404, 'Active profile not found')
            result = db.execute(update(memories).where(CAPTURE, memories.c.id.in_(ids)).values(
                capture_person_id=link.person_id, capture_auto_excluded=link.person_id is None,
                updated=self.records.now()
            ))
            if result.rowcount != len(ids):
                raise HTTPException(404, 'One or more captures are no longer available')


def memory_router(store, recognizer=None):
    router = APIRouter(prefix='/api/v1/memories')

    @router.post('/capture-groups')
    def capture_groups(auto_assign: bool = False):
        if recognizer is None:
            raise HTTPException(503, 'Face recognition is unavailable')
        return store.group_captures(recognizer, auto_assign)

    @router.put('/capture-links')
    def capture_links(link: CaptureLink):
        store.link_captures(link)
        return {'status': 'saved'}

    @router.delete('/expired-captures')
    def expire_captures(days: int):
        if days not in (1, 7, 30):
            raise HTTPException(422, 'Invalid capture retention period')
        store.expire_captures(store.records.now() - days * 86400000)
        return {'status': 'deleted'}

    @router.post('', status_code=201)
    async def save(request: Request):
        async with request.form(max_files=1, max_fields=4, max_part_size=20000) as form:
            image = form.get('image')
            if not isinstance(image, UploadFile):
                raise HTTPException(422, 'Choose a still image to save')
            source = form.get('source')
            original = form.get('ocr_text', '')
            if source not in {'camera', 'file'} or not isinstance(original, str) or len(original) > 12000:
                raise HTTPException(422, 'Invalid image provenance')
            try:
                note = NoteInput(title=form.get('title'), text=form.get('text'))
            except ValidationError:
                raise HTTPException(422, 'Enter a title (up to 200 characters) and description (up to 12,000 characters)') from None
            payload = await image.read(MAX_IMAGE_BYTES+1)
            return await run_in_threadpool(store.save, payload, note, original, source)

    @router.get('')
    def find(q: str = ''):
        if len(q) > 200:
            raise HTTPException(422, 'Search is limited to 200 characters')
        return {'memories': store.find(q)}

    @router.get('/{identity}/image')
    def image(identity: str):
        return Response(store.image(identity), media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @router.put('/{identity}')
    def edit(identity: str, note: NoteInput):
        return store.edit(identity, note)

    @router.delete('/{identity}')
    def remove(identity: str):
        store.delete(identity)
        return {'status': 'deleted'}

    return router
