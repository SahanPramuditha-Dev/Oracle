"""Store reviewed capture links to enrolled profiles."""
from alembic import op
import sqlalchemy as sa

revision = '0010_capture_folders'
down_revision = '0009_atlas_locations'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('memories') as table:
        table.add_column(sa.Column('capture_person_id', sa.String(100), nullable=True))
        table.create_foreign_key('capture_person_fk', 'enrolled_people', ['capture_person_id'], ['id'], ondelete='SET NULL')


def downgrade():
    with op.batch_alter_table('memories') as table:
        table.drop_constraint('capture_person_fk', type_='foreignkey')
        table.drop_column('capture_person_id')
