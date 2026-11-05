"""Separate stable identities from biometric samples without merging names."""
from alembic import op
import hashlib
import sqlalchemy as sa

revision = '0004_identity_samples'
down_revision = '0003_enrolled_people'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('enrolled_people', sa.Column('relationship', sa.String(20), nullable=False, server_default='guest'))
    op.add_column('enrolled_people', sa.Column('permission', sa.String(20), nullable=False, server_default='standard'))
    op.add_column('enrolled_people', sa.Column('enrollment_state', sa.String(30), nullable=False, server_default='needs_new_samples'))
    samples = op.create_table('face_samples',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('person_id', sa.String(100), sa.ForeignKey('enrolled_people.id', ondelete='CASCADE'), nullable=False),
        sa.Column('embedding', sa.LargeBinary(), nullable=False),
        sa.Column('sample_hash', sa.String(64), nullable=False),
        sa.Column('created', sa.BigInteger(), nullable=False),
        sa.Column('quality', sa.Text(), nullable=False))
    connection = op.get_bind()
    for row in connection.execute(sa.text('SELECT id, embedding, created FROM enrolled_people')).mappings():
        embedding = bytes(row['embedding'])
        connection.execute(samples.insert().values(id='legacy_' + hashlib.sha256(row['id'].encode()).hexdigest(), person_id=row['id'],
            embedding=embedding, sample_hash=hashlib.sha256(embedding).hexdigest(), created=row['created'], quality='{"source":"legacy","evaluated":false}'))
    with op.batch_alter_table('enrolled_people') as batch:
        batch.drop_column('embedding')
    op.create_index('face_sample_person', 'face_samples', ['person_id'])
    op.create_index('face_sample_unique', 'face_samples', ['person_id', 'sample_hash'], unique=True)

def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
