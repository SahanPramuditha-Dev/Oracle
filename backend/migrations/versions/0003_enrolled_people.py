"""Enrolled people for local face recognition and identification."""
from alembic import op
import sqlalchemy as sa

revision = '0003_enrolled_people'
down_revision = '0002_image_memory'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('enrolled_people',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('created', sa.BigInteger(), nullable=False),
        sa.Column('updated', sa.BigInteger(), nullable=False),
        sa.Column('embedding', sa.LargeBinary(), nullable=False))
    op.create_index('person_name', 'enrolled_people', ['name'])
    op.create_index('person_created', 'enrolled_people', [sa.text('created DESC'), 'id'])
    op.execute(sa.insert(sa.table('record_locks', sa.column('name', sa.String()))).values(name='enrolled_people'))


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
