"""Vision endpoints for local object/person detection and visual Q&A."""
import asyncio
import logging
import re

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from .reading import decode_image
from .detector import ObjectDetector, MODEL_PATH
from .gemini import ProviderError
from .everyday_objects import EverydayObjectDetector

logger = logging.getLogger(__name__)


def vision_router(detector: ObjectDetector, ollama=None, everyday=None):
    router = APIRouter(prefix='/api/v1/vision')
    segmenter = ObjectDetector(MODEL_PATH.with_name('yolov8n-seg.onnx'))
    object_lock = asyncio.Lock()
    everyday = everyday or EverydayObjectDetector()

    @router.post('/detect')
    async def detect_objects(
        request: Request,
        segment: bool = Query(False),
        confidence: float = Query(0.35, ge=0.1, le=1.0),
    ):
        content_type = request.headers.get('content-type', '').split(';')[0]
        if content_type not in {'image/png', 'image/jpeg'}:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        payload = await request.body()
        picture = decode_image(payload)
        engine = segmenter if segment else detector
        try:
            return await run_in_threadpool(engine.detect, picture, confidence)
        except FileNotFoundError:
            raise HTTPException(503, 'Local vision model is missing') from None

    @router.get('/objects/capabilities')
    def object_capabilities():
        return {'open_vocabulary':everyday.available,'classes':everyday.classes,
                'closeups':True,'local_description':ollama is not None,'processing':'local'}

    @router.post('/objects/identify')
    async def identify_held_object(request: Request):
        content_type = request.headers.get('content-type', '').split(';')[0]
        if content_type not in {'image/png', 'image/jpeg'}:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        payload = await request.body()
        picture = decode_image(payload)
        if object_lock.locked():
            raise HTTPException(429, 'Object recognition is already running; try again shortly')
        async with object_lock:
            result = None
            persons = []
            if everyday.available:
                try:
                    people_result=await run_in_threadpool(detector.detect,picture)
                    persons=[d for d in people_result['detections'] if d['class']=='person'][:2]
                    result=await run_in_threadpool(everyday.detect,picture,persons)
                except Exception:
                    logger.exception('Optional object detector failed; using local description')
            if ollama is None:
                if result is not None:
                    return {**result,'description':'Object unclear; move it closer and hold still',
                        'source':'open_vocabulary','is_estimate':True}
                raise HTTPException(503, 'Local object recognition is not configured')
            # Moondream is more reliable with a short question than with a long
            # instruction block. Avoid assuming a person in a close-up photo.
            prompt = 'What object, if any, is the person holding?' if persons else 'What object is in the foreground?'
            try:
                answer = await ollama.analyze_image(payload, prompt)
            except ProviderError as err:
                if err.code != 'provider_empty':
                    raise HTTPException(err.status, err.message) from None
                answer = 'Object unclear; move it closer and hold still.'
        answer = answer.strip().partition('\n')[0] or 'Object unclear; move it closer and hold still.'
        if result is not None:
            # Cross-check open-vocabulary labels with an independent local visual
            # description. A high detector score alone can still be confidently wrong.
            aliases={'pen':['pen','ballpoint'],'mobile phone':['phone','smartphone'],
                'eyeglasses':['glasses','eyeglasses'],'keys':['key','keys'],
                'USB cable':['cable','cord'],'phone charger':['charger'],
                'earbuds':['earbud','earbuds','earphones'],'USB flash drive':['flash drive','usb stick'],
                'adhesive tape':['tape'],'wristwatch':['watch','wristwatch']}
            description=answer.casefold()
            uncertain=bool(re.search(r'\b(no|not|cannot|maybe|possibly|unclear|uncertain|nothing|or|might|could)\b',description))
            agreed=[]
            for d in result['detections']:
                words=aliases.get(d['class'],[d['class']])
                if not d['ambiguous'] and not uncertain and any(re.search(r'\b'+re.escape(word)+r'\b',description) for word in words):
                    agreed.append({**d,'corroborated':True})
            if agreed:
                return {**result,'detections':agreed,'description':answer[:600],
                    'source':'open_vocabulary','is_estimate':True,'cross_checked':True}
        return {'description':answer[:600],'source':'local_vision','model':getattr(ollama,'vision_model','moondream'),
            'processing':'local','is_estimate':True,'detections':[],
            'rejected_candidates':len(result['detections']) if result else 0,
            'detector_available':everyday.available}

    @router.post('/ask')
    async def ask_vision(
        request: Request,
        prompt: str = Query('Describe this image in detail.', max_length=1000),
    ):
        if ollama is None:
            raise HTTPException(503, 'Local vision model is not configured')
        content_type = request.headers.get('content-type', '').split(';')[0]
        if content_type not in {'image/png', 'image/jpeg'}:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        payload = await request.body()
        decode_image(payload)
        try:
            answer = await ollama.analyze_image(payload, prompt)
        except ProviderError as err:
            raise HTTPException(err.status, err.message) from None
        return {
            'answer': answer,
            'model': getattr(ollama, 'vision_model', 'moondream'),
            'provider': 'Ollama',
            'processing': 'local',
        }

    return router
