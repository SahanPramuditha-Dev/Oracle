"""Explicit image memories, corrected descriptions and original OCR provenance."""
from alembic import op
import sqlalchemy as sa

revision = '0002_image_memory'
down_revision = '0001_productivity'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('memories',
        sa.Column('id', sa.String(100), primary_key=True), sa.Column('title', sa.String(200), nullable=False),
        sa.Column('text', sa.Text(), nullable=False), sa.Column('ocr_text', sa.Text(), nullable=False),
        sa.Column('created', sa.BigInteger(), nullable=False), sa.Column('updated', sa.BigInteger(), nullable=False),
        sa.Column('source', sa.String(20), nullable=False), sa.Column('width', sa.BigInteger(), nullable=False),
        sa.Column('height', sa.BigInteger(), nullable=False), sa.Column('sha256', sa.String(64), nullable=False),
        sa.Column('image', sa.LargeBinary(), nullable=False))
    op.create_index('memory_created', 'memories', [sa.text('created DESC'), 'id'])
    op.execute(sa.insert(sa.table('record_locks', sa.column('name', sa.String()))).values(name='memories'))


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
