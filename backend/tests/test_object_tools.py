import sys
from pathlib import Path
import pytest
import yaml
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from evaluate_objects import score_image
from train_object_detector import validate_dataset


def dataset(tmp_path):
    for split,color in [('train','white'),('val','gray')]:
        images=tmp_path/'images'/split;labels=tmp_path/'labels'/split
        images.mkdir(parents=True);labels.mkdir(parents=True)
        Image.new('RGB',(64,64),color).save(images/'sample.png')
        (labels/'sample.txt').write_text('0 0.5 0.5 0.5 0.5')
    path=tmp_path/'dataset.yaml'
    path.write_text(yaml.safe_dump({'path':'.','train':'images/train','val':'images/val','names':['pen']}))
    return path


def test_evaluation_counts_duplicate_and_wrong_class_detections():
    truth=[{'class':'pen','box':[0,0,100,20]}]
    predicted=[{'class':'pen','box':[0,0,100,20],'confidence':.9},
               {'class':'pen','box':[0,0,100,20],'confidence':.8},
               {'class':'scissors','box':[0,0,100,20],'confidence':.7}]
    stats=score_image(truth,predicted)
    assert stats['pen']=={'tp':1,'fp':1,'fn':0}
    assert stats['scissors']=={'tp':0,'fp':1,'fn':0}
    assert score_image(truth,[])['pen']['fn']==1


def test_training_requires_disjoint_real_captures(tmp_path):
    path=dataset(tmp_path)
    assert validate_dataset(path)[1]=={'train':1,'val':1}
    (tmp_path/'images/val/sample.png').write_bytes((tmp_path/'images/train/sample.png').read_bytes())
    with pytest.raises(ValueError,match='same image'):validate_dataset(path)


def test_training_requires_valid_annotation_boxes(tmp_path):
    path=dataset(tmp_path)
    (tmp_path/'labels/train/sample.txt').write_text('0 0.5 0.5 1.5 0.5')
    with pytest.raises(ValueError,match='Invalid class'):validate_dataset(path)
    (tmp_path/'labels/train/sample.txt').unlink()
    with pytest.raises(ValueError,match='Missing annotation'):validate_dataset(path)
