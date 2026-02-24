import { Test, TestingModule } from '@nestjs/testing';
import { SriService } from './sri.service';

describe('SriService', () => {
  let service: SriService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SriService],
    }).compile();

    service = module.get<SriService>(SriService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
