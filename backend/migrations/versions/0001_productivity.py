"""Durable notes, tasks, indexes and transactional quota locks."""
from alembic import op
import sqlalchemy as sa

revision = '0001_productivity'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    schemas = {
        'tasks': [sa.Column('id', sa.String(100), primary_key=True), sa.Column('title', sa.String(200), nullable=False),
                  sa.Column('due', sa.BigInteger(), nullable=False), sa.Column('kind', sa.String(20), nullable=False),
                  sa.Column('created', sa.BigInteger(), nullable=False), sa.Column('url', sa.Text())],
        'notes': [sa.Column('id', sa.String(100), primary_key=True), sa.Column('title', sa.String(200), nullable=False),
                  sa.Column('text', sa.Text(), nullable=False), sa.Column('created', sa.BigInteger(), nullable=False),
                  sa.Column('updated', sa.BigInteger(), nullable=False)]}
    for name, columns in schemas.items():
        if name not in existing:
            op.create_table(name, *columns)
        elif {c['name'] for c in sa.inspect(bind).get_columns(name)} != {c.name for c in columns}:
            raise RuntimeError('Existing record schema differs; migration stopped without overwriting it')
    for table, index, columns in [('tasks', 'task_due', ['due']), ('notes', 'note_updated', [sa.text('updated DESC'), 'id'])]:
        if index not in {item['name'] for item in sa.inspect(bind).get_indexes(table)}:
            op.create_index(index, table, columns)
    op.create_table('record_locks', sa.Column('name', sa.String(20), primary_key=True))
    op.bulk_insert(sa.table('record_locks', sa.column('name', sa.String())), [{'name': 'tasks'}, {'name': 'notes'}])


def downgrade():
    raise RuntimeError('Destructive downgrade disabled; restore a verified backup instead')
