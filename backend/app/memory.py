"""Explicit, transactionally stored image memories; no inference or cloud transfer on save."""
from io import BytesIO
import hashlib
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import delete, func, insert, select, update
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from .database import memories
from .reading import decode_image, MAX_IMAGE_BYTES
from .records import NoteInput

SUMMARY = [column for column in memories.c if column.name != 'image']


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
                    sha256=hashlib.sha256(image).hexdigest())
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


def memory_router(store):
    router = APIRouter(prefix='/api/v1/memories')

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
