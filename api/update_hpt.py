import asyncio
from database import async_session_maker
from sqlmodel import select
from models import BenchmarkRun

async def update_hpt():
    # Hardcode the HPT values we calculated earlier
    hpt_data = {
        'reliability': 100.0,
        'percentile_90': 1.04,
        'percentile_95': 1.03,
        'percentile_99': 1.03
    }
    
    async with async_session_maker() as session:
        result = await session.execute(
            select(BenchmarkRun)
            .where(BenchmarkRun.directory_name == 'bm-20251115-3.15.0a1+-ed73c90-JIT')
        )
        run = result.scalar_one_or_none()
        
        if run:
            run.hpt_reliability = hpt_data['reliability']
            run.hpt_percentile_90 = hpt_data['percentile_90']
            run.hpt_percentile_95 = hpt_data['percentile_95']
            run.hpt_percentile_99 = hpt_data['percentile_99']
            
            session.add(run)
            await session.commit()
            print(f'Updated {run.directory_name} with HPT data')
            print(f'  Reliability: {run.hpt_reliability}%')
            print(f'  99th percentile: {run.hpt_percentile_99}x')
        else:
            print('Run not found')

asyncio.run(update_hpt())
