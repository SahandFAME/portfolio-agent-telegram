"""Read-only schema/coverage audit. No workbook contents, balances or quotes logged."""
from collections import Counter
from datetime import date, datetime
from io import BytesIO
import json
import re
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
from verify_onedrive import MAPPING, SyncError, download_workbook, extract_quantities, graph_token


def audit(content):
    extract_quantities(content)  # Existing archive-size/XML and current-total safeguards.
    book=load_workbook(BytesIO(content),data_only=True,keep_links=False)
    try:
        tables={table.name:(sheet,table) for sheet in book for table in sheet.tables.values()}
        result=[]
        for asset,spec in MAPPING.items():
            sheet,table=tables[spec['table']]
            left,top,right,bottom=range_boundaries(table.ref)
            headers=[column.name for column in table.tableColumns]
            qty=left+headers.index(spec['column'])
            rows=[r for r in range(top+1,bottom) if any(sheet.cell(r,c).value is not None for c in range(left,right+1))]
            types=Counter(); dates=[]; negative=0; quantity_rows=0; net=0.0
            for row in rows:
                value=sheet.cell(row,qty).value
                if isinstance(value,(int,float)) and not isinstance(value,bool):
                    quantity_rows+=1;negative+=value<0;net+=value
                for col in range(left,right+1):
                    value=sheet.cell(row,col).value
                    if isinstance(value,(date,datetime)):
                        types['excel_date']+=1;dates.append(value.date() if isinstance(value,datetime) else value)
                    elif isinstance(value,str) and re.fullmatch(r'\s*[0-9۰-۹٠-٩]{2,4}[/-][0-9۰-۹٠-٩]{1,2}[/-][0-9۰-۹٠-٩]{1,2}\s*',value):
                        types['date_text']+=1
            balance=sheet.cell(bottom,qty).value
            result.append({'asset':asset,'headers':headers,'nonempty_rows':len(rows),'numeric_quantity_rows':quantity_rows,
                'negative_quantity_rows':negative,'date_cell_types':dict(types),
                'first_excel_date':min(dates).isoformat() if dates else None,'last_excel_date':max(dates).isoformat() if dates else None,
                'transaction_net_matches_current_total':isinstance(balance,(int,float)) and abs(net-balance)<=max(1e-8,abs(balance)*1e-10)})
        return {'ok':True,'configured_tables':len(result),'unconfigured_table_count':len(tables)-len(MAPPING),'tables':result}
    finally:book.close()

def provider_probes():
    from urllib.request import Request, urlopen
    probes=[]
    for url in [
        'https://api.tgju.org/v1/market/indicator/summary-table-data/geram18?lang=fa&start=0&length=600&order_dir=asc',
        'https://api.tgju.org/v1/market/indicator/summary-table-data/price_dollar_rl?lang=fa&start=0&length=600&order_dir=asc',
        'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365']:
        try:
            with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=12) as response:
                data=json.loads(response.read(5000000))
            rows=data.get('data',data.get('prices',[]))
            probes.append({'url':url,'ok':True,'keys':list(data)[:12],'row_count':len(rows),'first':rows[:1],'last':rows[-1:]})
        except Exception as error:probes.append({'url':url,'ok':False,'error':type(error).__name__})
    return probes


if __name__=='__main__':
    try:
        content,_=download_workbook(graph_token())
        result=audit(content)
        result['provider_probes']=provider_probes()
        print(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,SyncError) else 'history_audit_failed'}))
        raise SystemExit(1)
