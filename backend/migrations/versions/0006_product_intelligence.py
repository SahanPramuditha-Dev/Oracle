"""Add local product knowledge and lookup history."""
from alembic import op
import sqlalchemy as sa

revision = '0006_product_intelligence'
down_revision = '0005_voice_samples'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'product_records',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('barcode', sa.String(80)),
        sa.Column('brand', sa.String(200)),
        sa.Column('name', sa.String(300), nullable=False),
        sa.Column('variant', sa.String(300)),
        sa.Column('category', sa.String(120)),
        sa.Column('manufacturer', sa.String(200)),
        sa.Column('model', sa.String(200)),
        sa.Column('packaging', sa.String(200)),
        sa.Column('capacity', sa.String(100)),
        sa.Column('specifications', sa.Text(), nullable=False),
        sa.Column('source_url', sa.Text()),
        sa.Column('verification_status', sa.String(30), nullable=False),
        sa.Column('updated', sa.BigInteger(), nullable=False),
    )
    op.create_index('product_barcode', 'product_records', ['barcode'])
    op.create_index('product_name', 'product_records', ['name'])
    op.create_table(
        'product_lookup_history',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('query', sa.Text(), nullable=False),
        sa.Column('result', sa.Text(), nullable=False),
        sa.Column('created', sa.BigInteger(), nullable=False),
    )


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
