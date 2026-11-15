from app.product_intelligence import Evidence, ProductKnowledgeService, rank_candidates, resolve_product


def test_barcode_is_stronger_than_partial_ocr():
    evidence = [
        Evidence(kind='object_detection', value='bottle', confidence=.91),
        Evidence(kind='ocr', value='Lemon drink', confidence=.72),
        Evidence(kind='barcode', value='012345678905', confidence=.98),
    ]
    records = [
        {'id': 'a', 'barcode': '012345678905', 'brand': 'Acme', 'name': 'Lemon Drink',
         'verification_status': 'verified', 'category': 'beverage'},
        {'id': 'b', 'barcode': '999999999999', 'brand': 'Other', 'name': 'Lemon Drink',
         'verification_status': 'verified', 'category': 'beverage'},
    ]
    result = resolve_product(evidence, records)
    assert result.product.barcode == '012345678905'
    assert result.product_status == 'verified'


def test_logo_or_object_evidence_does_not_invent_exact_product():
    evidence = [Evidence(kind='object_detection', value='bottle', confidence=.95)]
    result = resolve_product(evidence, [])
    assert result.product.name is None
    assert result.brand['status'] == 'unknown'
    assert result.needs_more_evidence is True


def test_close_candidates_are_marked_conflicting():
    evidence = [Evidence(kind='ocr', value='cola', confidence=.8)]
    records = [
        {'id': 'a', 'brand': 'A', 'name': 'Cola', 'verification_status': 'probable'},
        {'id': 'b', 'brand': 'B', 'name': 'Cola', 'verification_status': 'probable'},
    ]
    result = resolve_product(evidence, records)
    assert result.product_status in {'conflicting', 'uncertain'}
    assert result.needs_more_evidence


def test_empty_knowledge_service_is_offline_safe():
    assert ProductKnowledgeService().lookup(terms=['anything']) == []
    assert rank_candidates([], []) == []


def test_product_result_prefers_object_over_person_detection():
    evidence = [
        Evidence(kind='object_detection', value='person', confidence=.99),
        Evidence(kind='object_detection', value='bottle', confidence=.88),
    ]
    result = resolve_product(evidence, [])
    assert result.object_type == 'bottle'


def test_moondream_observation_is_exposed_without_becoming_verified_product_data():
    evidence = [
        Evidence(kind='object_detection', value='bottle', confidence=.88),
        Evidence(kind='vlm', value='A green plastic bottle with a visible Sprite label.',
                 confidence=.55, source='moondream'),
    ]
    result = resolve_product(evidence, [])
    assert result.attributes['visual_summary'] == 'A green plastic bottle with a visible Sprite label.'
    assert result.product.name is None
    assert result.brand['status'] == 'unknown'


def test_seed_catalog_matches_equivalent_gtin_and_rejects_bad_check_digit():
    catalog = ProductKnowledgeService()
    assert catalog.lookup(barcode='012345678905')[0]['id'] == 'oracle-demo'
    assert catalog.lookup(barcode='012345678901') == []


def test_unknown_barcode_and_brand_are_exposed_without_exact_match():
    evidence = [
        Evidence(kind='barcode', value='4006381333931', confidence=.95),
        Evidence(kind='ocr', value='Example Brand Lemon Lime', confidence=.9),
    ]
    assert resolve_product(evidence, []).brand['name'] is None
    result = resolve_product(evidence, [{'brand': 'Example Brand', 'name': 'Orange Soda'}])
    assert result.brand['name'] == 'Example Brand'
    assert result.product.barcode == '4006381333931'
    assert result.product.name is None


def test_label_brand_conflicting_with_barcode_requires_rescan():
    barcode = '012345678905'
    evidence = [
        Evidence(kind='barcode', value=barcode, confidence=.95),
        Evidence(kind='ocr', value='Example Brand', confidence=.9),
    ]
    records = ProductKnowledgeService().lookup(barcode=barcode)
    result = resolve_product(evidence, [*records, {'brand': 'Example Brand', 'name': 'Orange Soda'}])
    assert result.product_status == 'conflicting'
    assert result.product.name is None


def test_scan_upc_image_resolves_offline_without_object_model():
    from io import BytesIO

    import numpy as np
    import zxingcpp
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from PIL import Image

    from app.product_intelligence import product_router

    barcode = zxingcpp.create_barcode('012345678905', zxingcpp.BarcodeFormat.UPCA)
    image = Image.fromarray(np.asarray(zxingcpp.write_barcode_to_image(barcode, scale=4)))
    payload = BytesIO()
    image.save(payload, format='PNG')
    app = FastAPI()
    app.include_router(product_router(None))
    response = TestClient(app).post('/api/v1/vision/products/inspect', content=payload.getvalue(),
                                    headers={'Content-Type': 'image/png', 'X-Oracle-Product-Mode': 'barcode'})
    assert response.status_code == 200
    assert response.json()['product']['name'] == 'Lemon Sparkling Water'
    assert response.json()['product_status'] == 'verified'


def test_two_angles_resolve_together_and_keep_evidence_locations(monkeypatch):
    import asyncio

    import httpx
    from fastapi import FastAPI

    from app import product_intelligence as products

    async def run_locally(function, *args, **kwargs):
        return function(*args, **kwargs)

    def extract(image, _detections):
        if image == b'front':
            return [Evidence(kind='ocr', value='Oracle Demo', confidence=.95, bounds=(.1, .2, .3, .4))]
        if image == b'back':
            return [Evidence(kind='barcode', value='012345678905', confidence=.98, bounds=(.2, .3, .4, .5))]
        return []

    visual_calls = []

    class VisionModel:
        vision_model = 'test-vision'

        async def analyze_image(self, image, _prompt):
            visual_calls.append(image)
            return 'A plain bottle.'

    monkeypatch.setattr(products, 'run_in_threadpool', run_locally)
    monkeypatch.setattr(products, 'decode_image', lambda image: image)
    monkeypatch.setattr(products, '_extract_evidence', extract)
    app = FastAPI()
    app.include_router(products.product_router(None, VisionModel()))

    async def inspect():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            path = '/api/v1/vision/products/inspect'
            matched = await client.post(path, files={
                'first': ('front.jpg', b'front', 'image/jpeg'),
                'current': ('back.jpg', b'back', 'image/jpeg'),
            })
            scans = [
                await client.post(path, content=image, headers={
                    'Content-Type': 'image/jpeg', 'X-Oracle-Product-Mode': mode,
                })
                for mode in ('angle', 'auto', 'barcode')
                for image in (b'front', b'blank')
            ]
            return matched, scans

    response, scans = asyncio.run(inspect())
    assert response.status_code == 200
    result = response.json()
    assert result['product_status'] == 'verified'
    assert [(item['angle'], item['bounds']) for item in result['evidence']] == [
        (0, [.1, .2, .3, .4]), (1, [.2, .3, .4, .5]),
    ]
    assert all(scan.status_code == 200 for scan in scans)
    assert visual_calls == [b'blank', b'blank']
    for scan in (scans[1], scans[3]):
        assert scan.json()['evidence'][0]['source'] == 'test-vision'
        assert scan.json()['product']['name'] is None
