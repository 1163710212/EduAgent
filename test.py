import requests
from concurrent.futures import ThreadPoolExecutor

def post_request(port):
    response = requests.post("http://127.0.0.1:6012/api/generate"
, json={
        "model": "llama3.1",
        "prompt": "你好xxxx",
        "stream": False
    })
    return response.json()["response"]


print(post_request(6012))