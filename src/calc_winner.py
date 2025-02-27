import hashlib

compare_against = int(hashlib.sha256(b"YadaCoin 2025").hexdigest(), 16)
print(compare_against)
contestants = [
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    '19LSVatG7eGSUco2JH3n5LGoNnRBfQyinU',
    '14VrpQrSphREnhkxcE8wKGCk1QV3h9xgnH',
    '1F4Lan5sKSKKASo3U5kvYdp5B3snfejmtc',
    '1CuVfXfwbFhNVb97bg3JJVweQBnvTR1gPA',
    '18fWa8vM52ic3j66wQDprmGacXMTo37LM4',
    '1QBiVm9RCjNqEDtmr1uWFF5o8M89b1N1ZP',
    '17Kjv2o3M9YqFV8TZNc3QXVx7LNoyS7pcb',
    '1CuRNjzAH7AUBw77mrBn8eih4Qg7JXL9YP',
    '1NiHN6aoKFFhVZ1qDDfNDdpEPqPFrSATBw',
    '18qvXTLkxLgtpe7hk8wLSbzsHR4GjFdreT',
    '1PdvaMC1SLL8GKFSU4Z2pHmrKX3jvJ8UNH',
    '186CS6EC1SaYKxgunwXLV5r5T3huKH3FBF',
    '19eeHQcxuT4thPb3wapKwdJuRjb75SkQE5',
    '19BnNLUWSZzYCXB9WXqFKYkG1YrBuYp7hM',
    '1PBw74V4W8CU759dwWWQtypQC9LSjr5Msc',
    '1DSbwBCfrKNH7VmdVsgbitvxRetoxDca5Q',
    '145bbaK36hfAHTDYD9Nx8SaxHbJvydUo23',
    '1C5RvjoVjt8YZFi7nGfUufdofpzQ5anYZS',
    '12M7d31HTB9dCuJvk3ZW8MuLjtafRgESv5',
    '1hFJTBwiWhrjoG2B6uvHF2URbKCAwpcdt',
    '1htmoGDMhiN79w6ArqWQxGUJ15hT486gQ',
    '1PdvaMC1SLL8GKFSU4Z2pHmrKX3jvJ8UNH',
    '1FE8E3AeXn1qTxH4cG5T51ikgiJd1Gzvz5',
    '18fWa8vM52ic3j66wQDprmGacXMTo37LM4',
]
lowest = (None, None)
for contestant in contestants:
    print(contestant)
    result = abs(compare_against - int(hashlib.sha256(contestant.encode()).hexdigest(), 16))
    print(result)
    if lowest[0] is None or result < lowest[0]:
        lowest = (result, contestant)
print(lowest)